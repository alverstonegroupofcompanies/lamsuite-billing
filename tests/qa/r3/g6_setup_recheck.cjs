/**
 * G6-SETUP against the live QA backend.
 *
 * SET-01 — a store's state code must be a real GST code that agrees with its
 *          GSTIN; store codes are short hyphenated uppercase.
 * MST-01 — a party's state comes from its GSTIN, else its own store.
 * SET-03 — a till's settings write cannot move numbering, and a stale write
 *          (old settings_version) is refused instead of overwriting.
 * MST-02 — a bill carrying only a typed name (no phone) creates no customer.
 *
 * Throwaway data only: it creates its own Karnataka (29) store, counter,
 * product and bills. Run with the r3 backend up (see README).
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
  const code = `G6KA-${stamp}`;
  const ev = { stamp };

  /* ---------- SET-01: store identity is validated ---------- */
  const bad = async (label, body) => {
    const res = await api('POST', '/admin/stores', { name: `G6 bad ${label}`, store_type: 'cosmetics', ...body }, { token: admin });
    ev[`store_${label}`] = { status: res.status, errors: res.json?.errors };
    return res;
  };
  check('SET-01 state "3232" is refused', (await bad('3232', { code: `G6X1-${stamp}`, state_code: '3232' })).status === 422);
  check('SET-01 GSTIN from another state is refused',
    (await bad('gstin', { code: `G6X2-${stamp}`, state_code: '29', gstin: '32ABCDE1234F1Z5' })).status === 422);
  check('SET-01 store code with spaces is refused', (await bad('code', { code: `G6 X3 ${stamp}`, state_code: '29' })).status === 422);
  check('SET-01 nothing was saved for refused stores',
    Number(one(`select count(*) from stores where name like 'G6 bad %'`)) === 0);

  const storeRes = await api('POST', '/admin/stores', {
    name: `G6 Karnataka QA ${stamp}`,
    code: code.toLowerCase(),
    state_code: '29',
    gstin: '29ABCDE1234F1Z5',
    store_type: 'cosmetics',
    gst_type: 'regular',
    tax_mode: 'exclusive',
  }, { token: admin });
  if (storeRes.status !== 201) throw new Error('store create failed ' + storeRes.text);
  const storeId = storeRes.json.id;
  ev.storeId = storeId;
  check('SET-01 store code is saved uppercase', storeRes.json.code === code, storeRes.json.code);

  const put = await api('PUT', `/admin/stores/${storeId}`, { state_code: '32332' }, { token: admin });
  check('SET-01 update to "32332" is refused', put.status === 422, `HTTP ${put.status}`);
  check('SET-01 stored state is still 29', one(`select state_code from stores where id=${storeId}`) === '29');

  /* ---------- MST-01: party state follows GSTIN, else the store ---------- */
  const party = async (body) => api('POST', '/admin/parties', { store_id: storeId, ...body }, { token: admin, store: storeId });
  const mh = await party({ type: 'supplier', name: `G6 MH Wholesale ${stamp}`, gstin: '27AAACQ5678B1Z2' });
  const ka = await party({ type: 'customer', name: `G6 KA Client ${stamp}` });
  const clash = await party({ type: 'supplier', name: `G6 Clash ${stamp}`, gstin: '27AAACQ5678B1Z2', state_code: '29' });
  ev.parties = { mh: mh.json, ka: ka.json, clash: { status: clash.status, errors: clash.json?.errors } };
  check('MST-01 supplier with GSTIN 27… is state 27',
    one(`select state_code from parties where name='G6 MH Wholesale ${stamp}'`) === '27');
  check('MST-01 customer without GSTIN takes the store state 29',
    one(`select state_code from parties where name='G6 KA Client ${stamp}'`) === '29');
  check('MST-01 a state contradicting the GSTIN is refused', clash.status === 422, `HTTP ${clash.status}`);

  /* ---------- a counter for the till-side checks ---------- */
  const counterRes = await api('POST', '/admin/counters', { counter_name: 'G6 Front Till', location_name: 'Front desk' }, { token: admin, store: storeId });
  if (counterRes.status !== 201 && counterRes.status !== 200) throw new Error('counter create failed ' + counterRes.text);
  const codeRes = await api('POST', `/admin/counters/${counterRes.json.counter.id}/activation-code`, {}, { token: admin, store: storeId });
  if (codeRes.status !== 200) throw new Error('activation code failed ' + codeRes.text);
  const claimRes = await api('POST', '/counters/claim', { code: codeRes.json.code, device_uuid: `g6-setup-${stamp}`, device_name: 'G6 QA till' });
  if (claimRes.status !== 200 || !claimRes.json.device_token) throw new Error('claim failed ' + claimRes.text);
  const device = claimRes.json.device_token;

  /* ---------- SET-03: settings writes from a till ---------- */
  const read = await api('GET', '/settings', undefined, { device });
  const v0 = read.json?.settings_version;
  check('SET-03 settings carry a settings_version', Number.isInteger(v0), `v=${v0}`);
  const prefixBefore = one(`select invoice_prefix from stores where id=${storeId}`);

  const seqWrite = await api('POST', '/settings', {
    settings_version: v0,
    sequences: { invoicePrefix: 'HACK', nextInvoiceNumber: 1001 },
    next_invoice_number: 1001,
    printing: { footerNote: `G6 ${stamp}` },
  }, { device });
  check('SET-03 a current write is accepted and moves the version on',
    seqWrite.status === 200 && seqWrite.json?.settings?.settings_version === v0 + 1, `HTTP ${seqWrite.status}`);
  check('SET-03 the till cannot change the invoice prefix',
    one(`select invoice_prefix from stores where id=${storeId}`) === prefixBefore, `${prefixBefore}`);
  check('SET-03 the till writes no sequences mirror',
    Number(one(`select count(*) from company_settings where store_id=${storeId} and key='sequences'`)) === 0);

  const stale = await api('POST', '/settings', { settings_version: v0, tax_mode: 'inclusive' }, { device });
  check('SET-03 a stale write is refused with 409', stale.status === 409, `HTTP ${stale.status}`);
  check('SET-03 the stale write changed nothing',
    one(`select tax_mode from stores where id=${storeId}`) === 'exclusive');
  ev.settings = { v0, seqWrite: seqWrite.status, stale: { status: stale.status, body: stale.json?.error } };

  /* ---------- MST-02: a typed name alone creates no customer ---------- */
  const productRes = await api('POST', '/products', {
    barcode: `G6BAR${stamp}`, name: 'G6 Ruby Lipstick', mrp: 500, sel_rate: 400, gst_percent: 18, units_per_pack: 1,
  }, { device });
  if (productRes.status !== 201) throw new Error('product create failed ' + productRes.text);
  const batchRes = await api('POST', `/products/${productRes.json.id}/batches`, {
    batch_no: 'G6-B1', expiry_date: '2028-01-01', stock_qty: 50, mrp: 500, purchase_rate: 300, selling_rate: 400,
  }, { device });
  if (batchRes.status !== 201) throw new Error('batch create failed ' + batchRes.text);

  const partiesBefore = Number(one(`select count(*) from parties where store_id=${storeId}`));
  const externalId = `g6_mst02_${stamp}`;
  const billRes = await api('POST', '/invoices', {
    external_id: externalId,
    idempotency_key: externalId,
    customer_name: 'G6 Credit',
    payment_mode: 'Cash',
    payments: [{ mode: 'Cash', amount: 472 }],
    items: [{ product_id: productRes.json.id, batch_id: batchRes.json.id, batch_no: 'G6-B1', qty: 1, unit_price: 400, gst_percent: 18 }],
  }, { device });
  ev.bill = { status: billRes.status, number: billRes.json?.invoice?.invoice_number, error: billRes.status >= 300 ? billRes.text : undefined };
  check('MST-02 the bill with a typed name saves', billRes.status === 201, `HTTP ${billRes.status}`);
  check('MST-02 no customer master is created for the typed name',
    Number(one(`select count(*) from parties where store_id=${storeId}`)) === partiesBefore &&
    Number(one(`select count(*) from parties where name='G6 Credit'`)) === 0);

  ev.failures = failures;
  const file = evidence('G6_setup_recheck', ev);
  console.log(`\n${failures.length ? failures.length + ' FAILED' : 'ALL PASS'} — evidence ${file}`);
  process.exit(failures.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(2);
});
