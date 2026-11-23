/**
 * G10-PAYMENTS live verification. Runs ONLY against an isolated throwaway stack:
 *   QA_BACKEND=http://127.0.0.1:8100 QA_DB=g10.sqlite node g10_probe.cjs
 * Mints its own device tokens inside the DB copy, so it never writes the shared
 * r3 state.json. Prints PASS/FAIL per defect claim and saves evidence JSON.
 */
const { api, sql, evidence, adminToken, BACKEND } = require('./lib.cjs');
const { issueCode } = require('./pos.cjs');

const T = [];
const check = (id, desc, ok, detail) => {
  T.push({ id, desc, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}  ${desc}  ${JSON.stringify(detail ?? null).slice(0, 300)}`);
};
const money = (v) => Number(v).toFixed(2);

/**
 * Lines priced inside the store's MRP ceiling (another group's rule) so the
 * money under test is the only thing the payload says.
 */
function itemsFor(grand, cap, p) {
  for (let q = 1; q <= 12; q++) {
    if (grand % q === 0 && grand / q <= cap) {
      return [{
        product_id: p.id, product_name: p.name, batch_id: p.batch, batch_no: p.batch_no,
        qty: q, loose_qty: 0, units_per_pack: 1, unit_price: grand / q, mrp: cap, gst_percent: p.gst,
        hsn_code: p.hsn,
      }];
    }
  }
  throw new Error(`no integer line under ${cap} lands on ${grand}`);
}

const P6 = { id: 6, name: 'QA Cough Syrup 100ml', batch: 7, batch_no: 'CS-A1', gst: 12, hsn: '30049011', cap: 120 };
const P4 = { id: 4, name: 'Kochi Exclusive Wellness Tonic', batch: 5, batch_no: 'BATCH-01', gst: 18, hsn: '30049099', cap: 450 };

// The probe writes real documents, so every fixture id is per-run: a second pass
// against the same database must not replay the first pass's rows into an empty
// shift window.
const SUF = Date.now().toString(36);
const CUST = `G10 Credit Customer ${SUF}`;

const bill = (n, o) => ({
  store_id: String(o.store), external_id: `g10-${n}-${SUF}`, idempotency_key: `g10-${n}-${SUF}`,
  invoice_number: `G10-${n}`, invoice_date: o.date || '2026-11-22',
  customer_name: o.customer || 'Walk-in Customer', customer_id: o.customerId,
  place_of_supply: '32-Kerala', tax_mode: 'inclusive',
  payment_mode: o.mode || 'Cash', paid_amount: o.paid, payments: o.payments,
  grand_total: o.grand, counter_code: o.counterCode,
  items: itemsFor(o.grand, o.product.cap, o.product),
});

/** The server owns invoice numbering, so the probe reads its bills back by external_id. */
const findInv = (n) => sql(`select id,invoice_number,grand_total,paid_amount,payment_status from invoices where external_id='g10-${n}-${SUF}'`)[0];

(async () => {
  const ev = {};
  const A = { token: await adminToken() };

  const claim = async (counterId, storeId, uuid) => {
    const code = await issueCode(counterId, storeId);
    const r = await api('POST', '/counters/claim', { code, device_uuid: uuid, device_name: 'QA G10 probe' });
    if (r.status !== 200 || !r.json?.device_token) throw new Error(`claim ${counterId} -> ${r.status} ${r.text.slice(0, 200)}`);
    return r.json.device_token;
  };
  const c4 = await claim(3, 4, 'qa-g10-probe-c02');  // store 4: saved payment modes, legacy profile
  const c2 = await claim(1, 2, 'qa-g10-probe-c01');  // store 2: no saved payment modes -> policy defaults
  ev.claimed = { store4_counter: 3, store2_counter: 1, tokens: 'redacted' };

  const S4 = { device: c4, token: c4, store: 4 };
  const S2 = { device: c2, token: c2, store: 2 };

  /** The expenses screen is a profile module; switch it on for one counter. */
  const enableExpenses = async (counterId, storeId) => {
    const g = await api('GET', `/admin/counters/${counterId}/profile`, undefined, { token: A.token, store: storeId });
    const d = g.json?.profile?.permissions || {};
    const r = await api('PUT', `/admin/counters/${counterId}/profile`, {
      profile: { ...d, modules: [...new Set([...(d.modules || []), 'expenses'])] },
    }, { token: A.token, store: storeId });
    return { http: r.status };
  };
  // store 2's counter gets the screen silently, so EXP-01e answers with the
  // reference policy rather than with the profile gate
  ev.expenses_enabled_store2 = await enableExpenses(1, 2);

  // ===== PAY-02  over-tender must not be booked as collected =================
  const pay02 = await api('POST', '/invoices', bill('P02', {
    store: 4, counterCode: 'C02', product: P6, grand: 210, paid: 210,
    payments: [{ mode: 'Cash', amount: 500 }],
  }), S4);
  const inv02 = findInv('P02');
  const row02 = inv02 ? sql(`select amount,tendered_amount,change_amount,payment_mode from invoice_payments where invoice_id=${inv02.id}`)[0] : null;
  ev.pay02 = { http: pay02.status, body: pay02.text.slice(0, 200), invoice: inv02, tender: row02 };
  check('PAY-02a', '₹500 tender on a ₹210 bill is accepted', pay02.status < 300, { http: pay02.status, body: pay02.text.slice(0, 160) });
  check('PAY-02b', 'tender row applies ₹210, records ₹500 tendered / ₹290 change',
    row02 && money(row02.amount) === '210.00' && money(row02.tendered_amount) === '500.00' && money(row02.change_amount) === '290.00', row02);
  check('PAY-02c', 'bill paid_amount is ₹210, not ₹500', inv02 && money(inv02.paid_amount) === '210.00' && money(inv02.grand_total) === '210.00', inv02);

  const syncKey = `g10-sync-p02-${Date.now()}`;
  const pay02s = await api('POST', '/sync/push/invoices', {
    invoices: [{
      id: syncKey, invoice_number: `C02-${syncKey}`, store_id: 4, customer_name: 'Walk-in Customer',
      invoice_date: '2026-11-22', grand_total: 210, paid_amount: 210, payment_mode: 'Cash',
      payments: [{ mode: 'Cash', amount: 500 }],
      items: [{ product_id: 6, product_name: 'QA Cough Syrup 100ml', batch_no: 'CS-A1', qty: 2, unit_price: 105, mrp: 120, gst_percent: 12 }],
    }],
  }, S4);
  const inv02s = sql(`select id,grand_total,paid_amount from invoices where invoice_number like '%${syncKey}'`)[0];
  const row02s = inv02s ? sql(`select amount,tendered_amount,change_amount from invoice_payments where invoice_id=${inv02s.id}`)[0] : null;
  ev.pay02_sync = { http: pay02s.status, body: pay02s.text.slice(0, 260), invoice: inv02s, tender: row02s };
  check('PAY-02d', "the till's sync path settles an over-collection instead of storing it",
    row02s && money(row02s.amount) === '210.00' && money(row02s.tendered_amount) === '500.00' && money(row02s.change_amount) === '290.00',
    { http: pay02s.status, tender: row02s });

  // ===== PAY-03  walk-in must never leave a balance ==========================
  const pay03 = await api('POST', '/invoices', bill('P03', {
    store: 4, counterCode: 'C02', product: P6, grand: 500, paid: 300,
    payments: [{ mode: 'Cash', amount: 300 }],
  }), S4);
  ev.pay03 = { http: pay03.status, body: pay03.text.slice(0, 300), rows: sql(`select count(*) n from invoices where external_id='g10-P03-${SUF}'`)[0].n };
  check('PAY-03a', 'walk-in ₹300 against a ₹500 bill is refused', pay03.status === 422,
    { http: pay03.status, msg: pay03.json?.message || pay03.json?.error });
  check('PAY-03b', 'no unpaid walk-in bill was written', ev.pay03.rows === 0, { rows: ev.pay03.rows });

  // ===== PAY-04  digital reference policy ====================================
  const p04a = await api('POST', '/invoices', bill('P04NOREF', {
    store: 2, counterCode: 'C01', product: P4, grand: 420, paid: 420, payments: [{ mode: 'UPI', amount: 420 }],
  }), S2);
  const p04b = await api('POST', '/invoices', bill('P04REF', {
    store: 2, counterCode: 'C01', product: P4, grand: 420, paid: 420,
    payments: [{ mode: 'UPI', amount: 420, reference_no: `UTRG10123456${SUF}`.slice(0, 35) }],
  }), S2);
  const p04c = await api('POST', '/invoices', bill('P04STORE4UPI', {
    store: 4, counterCode: 'C02', product: P6, grand: 210, paid: 210, payments: [{ mode: 'UPI', amount: 210 }],
  }), S4);
  ev.pay04 = {
    default_without_ref: { http: p04a.status, body: p04a.text.slice(0, 240) },
    default_with_ref: { http: p04b.status, body: p04b.text.slice(0, 160) },
    saved_optional_without_ref: { http: p04c.status, body: p04c.text.slice(0, 240) },
  };
  check('PAY-04a', 'unconfigured store: UPI with no reference is refused', p04a.status === 422,
    { http: p04a.status, msg: p04a.json?.message || p04a.json?.error });
  check('PAY-04b', 'UPI with a valid UTR is accepted', p04b.status < 300, { http: p04b.status });
  check('PAY-04c', "a store that saved 'optional' keeps its own choice", p04c.status < 300,
    { http: p04c.status, body: p04c.text.slice(0, 160) });

  // ===== SHF-01 + EXP-01  one shift, closed on the server's own figures ======
  await api('POST', '/admin/counters/3/unlock-pin/reset', { pin: '739214' }, { token: A.token, store: 4 });
  const shOpen = await api('POST', '/counter/shift/open', { pin: '739214', opening_float: 1000 }, S4);
  const shRow1 = sql('select id,status,opening_float,opened_at,closed_at from counter_shifts order by id desc limit 1')[0];
  ev.shift_open_body = shOpen.text.slice(0, 300);
  check('SHF-01a', 'shift open answers 200 with the shift document (no "Undefined array key opened_at")',
    shOpen.status === 200 && !/Undefined array key/i.test(shOpen.text) && (shOpen.json?.shift || shOpen.json?.shift_id),
    { http: shOpen.status, keys: Object.keys(shOpen.json || {}) });
  check('SHF-01b', 'opened_at is stamped', !!(shRow1 && shRow1.opened_at), shRow1);

  for (const [tag, mode, ref, amount] of [['CASH', 'Cash', null, 200], ['UPI', 'UPI', `UTR-SHOP-${SUF}`, 300]]) {
    const r = await api('POST', '/invoices', bill(`SH-${tag}`, {
      store: 4, counterCode: 'C02', product: P6, grand: amount, paid: amount, mode,
      payments: [{ mode, amount, reference_no: ref }],
    }), S4);
    ev[`shift_sale_${tag}`] = { http: r.status, body: r.text.slice(0, 160) };
  }

  // till expense: the legacy profile does not carry the screen yet
  const gp0 = await api('GET', '/admin/counters/3/profile', undefined, { token: A.token, store: 4 });
  const doc0 = gp0.json?.profile?.permissions || gp0.json?.profile || {};
  const legacy = { ...doc0, modules: (doc0.modules || []).filter((m) => m !== 'expenses') };
  await api('PUT', '/admin/counters/3/profile', { profile: legacy }, { token: A.token, store: 4 });
  const expBefore = await api('POST', '/expenses', { expense_head: 'Tea & snacks', amount: 50, payment_mode: 'Cash' }, S4);
  ev.expense_legacy_profile = { http: expBefore.status, body: expBefore.text.slice(0, 260) };
  check('EXP-01a', 'a counter profile that predates the expenses module is refused at the API',
    expBefore.status === 403 && /expenses/.test(expBefore.text), { http: expBefore.status, msg: expBefore.json?.message });

  const gp = await api('GET', '/admin/counters/3/profile', undefined, { token: A.token, store: 4 });
  const doc = gp.json?.profile?.permissions || gp.json?.profile || {};
  const enabled = { ...doc, modules: [...new Set([...(doc.modules || []), 'expenses'])] };
  const put = await api('PUT', '/admin/counters/3/profile', { profile: enabled }, { token: A.token, store: 4 });
  ev.expense_profile_enable = { http: put.status, sent_modules: enabled.modules, body: put.text.slice(0, 200) };
  check('EXP-01b', 'the owner can turn the expenses module on for the counter', put.status === 200,
    { http: put.status, body: put.text.slice(0, 200) });

  const expCash = await api('POST', '/expenses', { expense_head: 'Tea & snacks', amount: 50, payment_mode: 'Cash', notes: 'QA G10' }, S4);
  const expRow = expCash.status < 300
    ? sql(`select id,expense_number,store_id,counter_id,expense_head,amount,payment_mode from expenses where counter_id='3' order by id desc limit 1`)[0]
    : null;
  ev.expense_cash = { http: expCash.status, body: expCash.text.slice(0, 300), row: expRow };
  check('EXP-01c', 'the till books a cash expense against its own counter',
    expCash.status < 300 && expRow && String(expRow.counter_id) === '3' && expRow.store_id === 4, { http: expCash.status, row: expRow });

  const replayNo = `G10-EXP-REPLAY-${SUF}`;
  const expReplayA = await api('POST', '/expenses', { expense_head: 'Courier', amount: 40, payment_mode: 'Cash', expense_number: replayNo }, S4);
  const expReplayB = await api('POST', '/expenses', { expense_head: 'Courier', amount: 40, payment_mode: 'Cash', expense_number: replayNo }, S4);
  ev.expense_replay = {
    http: [expReplayA.status, expReplayB.status],
    rows: sql(`select count(*) n from expenses where expense_number='${replayNo}'`)[0].n,
  };
  check('EXP-01d', 'replaying a queued offline expense stays one row',
    expReplayA.status < 300 && expReplayB.status < 300 && ev.expense_replay.rows === 1, ev.expense_replay);

  const expDigital = await api('POST', '/expenses', { expense_head: 'Auto-charge', amount: 120, payment_mode: 'Card' }, S2);
  const expDigitalOk = await api('POST', '/expenses', { expense_head: 'Auto-charge', amount: 120, payment_mode: 'Card', reference_no: 'CARD-998877' }, S2);
  ev.expense_digital = { without_ref: { http: expDigital.status, body: expDigital.text.slice(0, 220) }, with_ref: { http: expDigitalOk.status } };
  check('EXP-01e', 'a digital till expense obeys the same reference policy',
    expDigital.status === 422 && expDigitalOk.status < 300, ev.expense_digital);

  const shClose = await api('POST', '/counter/shift/close', {
    pin: '739214', closing_cash_actual: 1150, opening_float: 1000,
    cash_sales: 0, digital_sales: 0, cash_refunds: 0, cash_expenses: 0,
  }, S4);
  const shRow2 = sql('select * from counter_shifts order by id desc limit 1')[0];
  const recon = shRow2 && shRow2.reconciliation_json ? JSON.parse(shRow2.reconciliation_json) : null;
  ev.shift_close = { http: shClose.status, body: shClose.text.slice(0, 800), row: shRow2, recon };
  const tallyBalances = recon && Math.abs(
    Number(recon.server.opening_float) + Number(recon.server.cash_collected) - Number(recon.server.cash_refunded)
    - Number(recon.server.cash_expenses) - Number(recon.server.expected_cash)) < 0.01;
  check('SHF-01c', 'shift close answers 200', shClose.status === 200, { http: shClose.status, body: shClose.text.slice(0, 200) });
  check('SHF-01d', "the server's own tally wins over the till's zeros",
    shRow2 && Number(shRow2.cash_sales) >= 200 && Number(shRow2.digital_sales) >= 300,
    shRow2 && { cash_sales: shRow2.cash_sales, digital_sales: shRow2.digital_sales, expected_cash: shRow2.expected_cash, discrepancy: shRow2.closing_discrepancy });
  check('SHF-01e', 'the till cash expenses land in the same shift reconciliation, and expected cash is the server figure',
    recon && Number(recon.server.cash_expenses) >= 90 && tallyBalances && recon.authority === 'server'
      && Math.abs(Number(shClose.json?.expected_cash) - Number(recon.server.expected_cash)) < 0.01,
    recon && { server: recon.server, drawer: recon.drawer, matches_server: recon.matches_server, window: recon.window });

  // ===== PAY-05  receipts must settle named bills ===========================
  const cust = await api('POST', '/admin/parties', { store_id: 4, type: 'customer', name: CUST, credit_limit: 100000 }, { token: A.token, store: 4 });
  const custId = Number(cust.json?.party?.id ?? sql(`select id from parties where store_id=4 and name='${CUST}'`)[0]?.id);
  ev.pay05 = { party: { http: cust.status, id: custId, body: cust.text.slice(0, 160) } };
  const balOf = () => Number(sql(`select current_balance from parties where id=${custId}`)[0].current_balance);
  const p5setup = [];
  for (const [n, amount, date] of [['A', 300, '2026-10-28'], ['B', 200, '2026-10-29'], ['C', 100, '2026-10-30']]) {
    const r = await api('POST', '/invoices', bill(`P05${n}`, {
      store: 4, counterCode: 'C02', product: P6, grand: amount, paid: 0, mode: 'Credit', date,
      payments: [{ mode: 'Credit', amount }], customer: CUST, customerId: custId,
    }), S4);
    p5setup.push({ n, http: r.status, body: r.text.slice(0, 160) });
  }
  ev.pay05.credit_sales = p5setup;
  if (p5setup.some((s) => s.http >= 300)) console.log('P05 setup failures: ' + JSON.stringify(p5setup));

  const docsRes = await fetch(`${BACKEND}/api/admin/outstanding-documents?store_id=4&party_type=customer&party_id=${custId}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${A.token}`, 'X-Store-Id': '4' },
  });
  const docsBody = await docsRes.json();
  const docs = docsBody.data || docsBody;
  const invA = findInv('P05A');
  const invB = findInv('P05B');
  const invC = findInv('P05C');
  const mine = [invA, invB, invC].filter(Boolean).map((i) => i.id);
  const g10open = (Array.isArray(docs) ? docs : []).filter((d) => mine.includes(d.document_id));
  ev.pay05.endpoint = { http: docsRes.status, rows: docs };
  check('PAY-05setup', 'three credit bills for one customer are open',
    p5setup.every((s) => s.http < 300) && invA && invB && invC && g10open.length === 3,
    { p5setup, open: g10open.map((d) => [d.document_number, d.outstanding]) });
  check('PAY-05a', 'outstanding-documents lists the open bills oldest-first with outstanding amounts',
    docsRes.status === 200 && g10open.length === 3 && g10open[0].document_id === invA.id
      && g10open.map((d) => d.document_id).join() === [invA.id, invB.id, invC.id].join()
      && g10open.every((d) => d.document_type === 'invoice' && d.outstanding > 0),
    { http: docsRes.status, rows: g10open.map((d) => [d.document_number, d.document_date, d.outstanding]) });

  const balBefore = balOf();

  const rcpt1 = await api('POST', '/admin/payments/customer', {
    store_id: 4, customer_id: custId, amount: 250, payment_mode: 'Cash', notes: 'G10 explicit',
    allocations: [{ invoice_id: invA && invA.id, amount: 150 }],
  }, { token: A.token, store: 4 });
  const s1 = {
    A: sql(`select paid_amount,payment_status from invoices where id=${invA.id}`)[0],
    B: sql(`select paid_amount from invoices where id=${invB.id}`)[0],
    allocs: sql('select document_type,document_id,amount from payment_allocations order by id desc limit 2'),
    bal: balOf(),
  };
  ev.pay05.receipt1 = { http: rcpt1.status, body: rcpt1.json, ...s1 };
  check('PAY-05b', 'a receipt with explicit allocations settles exactly the named bill',
    rcpt1.status < 300 && money(s1.A.paid_amount) === '150.00' && money(s1.B.paid_amount) === '0.00'
      && s1.allocs.filter((r) => Number(r.document_id) === invA.id).length === 1,
    { http: rcpt1.status, A: s1.A, allocated: rcpt1.json?.allocated_amount, unallocated: rcpt1.json?.unallocated_amount });
  check('PAY-05c', 'the customer balance moves once (₹250), not once per allocation',
    Math.abs((balBefore - s1.bal) - 250) < 0.01, { before: balBefore, after: s1.bal });

  const rcpt2 = await api('POST', '/admin/payments/customer', {
    store_id: 4, customer_id: custId, amount: 260, payment_mode: 'Cash', notes: 'G10 fifo',
  }, { token: A.token, store: 4 });
  const s2 = {
    A: sql(`select paid_amount,payment_status from invoices where id=${invA.id}`)[0],
    B: sql(`select paid_amount,payment_status from invoices where id=${invB.id}`)[0],
    C: sql(`select paid_amount from invoices where id=${invC.id}`)[0],
    bal: balOf(),
  };
  ev.pay05.receipt2 = { http: rcpt2.status, body: rcpt2.json, ...s2 };
  check('PAY-05d', 'a receipt with no allocations still clears A(150 left) then B by FIFO',
    rcpt2.status < 300 && money(s2.A.paid_amount) === '300.00' && s2.A.payment_status === 'paid'
      && money(s2.B.paid_amount) === '110.00' && money(s2.C.paid_amount) === '0.00',
    { http: rcpt2.status, A: s2.A, B: s2.B, C: s2.C });
  check('PAY-05e', 'the balance is debited by the receipts only (₹510 total)',
    Math.abs((balBefore - s2.bal) - 510) < 0.01, { before: balBefore, after: s2.bal });

  const supOpen = await fetch(`${BACKEND}/api/admin/outstanding-documents?store_id=4&party_type=supplier&party_id=8`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${A.token}`, 'X-Store-Id': '4' },
  });
  const supBody = await supOpen.json();
  const supDocs = supBody.data ?? supBody;
  const supTarget = (Array.isArray(supDocs) ? supDocs : [])[0];
  const supBefore = supTarget ? Number(supTarget.paid_amount) : 0;
  const supTake = supTarget ? Math.min(400, Number(supTarget.outstanding)) : 0;
  const supPay = await api('POST', '/admin/supplier-payments', {
    store_id: 4, supplier_id: 8, amount: 400, payment_mode: 'Cash',
    allocations: supTarget ? [{ purchase_id: supTarget.document_id, amount: supTake }] : undefined,
  }, { token: A.token, store: 4 });
  ev.pay05.supplier = {
    open_http: supOpen.status, open_rows: supDocs,
    pay: { http: supPay.status, body: supPay.json },
    allocs: sql("select document_type,document_id,amount from payment_allocations where payment_type='supplier_payment' order by id desc limit 2"),
    purchase: supTarget ? sql(`select invoice_number,grand_total,paid_amount from purchases where id=${supTarget.document_id}`)[0] : null,
  };
  check('PAY-05f', 'a supplier payment settles the purchase bill it names',
    supPay.status < 300 && Math.abs(Number(supPay.json?.allocated_amount) - supTake) < 0.01
      && money(ev.pay05.supplier.purchase?.paid_amount) === money(supBefore + supTake),
    { http: supPay.status, allocated: supPay.json?.allocated_amount, take: supTake, purchase: ev.pay05.supplier.purchase });

  evidence('G10_probe', { checks: T, ev });
  const failed = T.filter((t) => !t.ok);
  console.log(`\n${T.length - failed.length}/${T.length} checks passed`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.id).join(', '));
})().catch((e) => { console.error('probe error:', e.message); process.exit(1); });
