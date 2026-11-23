/**
 * G10 PAY-05 in the admin panel: a receipt must be able to name the bills it
 * settles, and leave that money where the operator said.
 *   QA_BACKEND=http://127.0.0.1:8100 QA_DB=g10.sqlite QA_ADMIN_URL=http://localhost:5175 node g10_panel_ui.cjs
 * Throwaway script: runs only against the isolated stack, never commits.
 */
const { sql, evidence, sleep, api, adminToken } = require('./lib.cjs');
const { newSession, ADMIN_URL } = require('./driver.cjs');
const { issueCode } = require('./pos.cjs');

const T = [];
const check = (id, desc, ok, detail) => {
  T.push({ id, desc, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}  ${desc}  ${JSON.stringify(detail ?? null).slice(0, 280)}`);
};
const money = (v) => Number(v).toFixed(2);

const SUF = Date.now().toString(36);
const PARTY = `G10 UI Credit ${SUF}`;

async function switchStore(s, code) {
  await s.page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && /STORE-0|QA-PH|QA-CS/.test(x.innerText) && x.innerText.includes('\n'));
    if (b) b.click();
  });
  await sleep(800);
  await s.page.evaluate((c) => {
    const b = [...document.querySelectorAll('button')].filter((x) => x.offsetParent && x.innerText.includes(c)).pop();
    if (b) b.click();
  }, code);
  await sleep(3000);
}

/** React ignores a written .value; flip the option and dispatch change instead. */
const pickOption = (s, which, value) => s.page.evaluate(({ w, v }) => {
  const el = [...document.querySelectorAll('select')].find((x) => x.offsetParent && [...x.options].some((o) => o.text.includes(w)));
  if (!el) return false;
  const opt = [...el.options].find((o) => o.value === v || o.text.includes(v));
  if (!opt) return false;
  opt.selected = true;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}, { w: which, v: value });

/** Type into a field the operator sees, with real keystrokes. */
async function typeIntoNthVisibleNumber(s, nth, value) {
  const ok = await s.page.evaluate((n) => {
    const el = [...document.querySelectorAll('input[type="number"]')].filter((i) => i.offsetParent)[n];
    if (!el) return false;
    el.focus();
    try { el.select(); } catch { /* number inputs reject setSelectionRange */ }
    return true;
  }, nth);
  if (!ok) return false;
  await s.page.keyboard.press('Backspace');
  await s.page.keyboard.type(String(value), { delay: 25 });
  await sleep(600);
  return s.page.evaluate((n) => {
    const el = [...document.querySelectorAll('input[type="number"]')].filter((i) => i.offsetParent)[n];
    return el ? el.value : null;
  }, nth);
}

const pickerRows = (s) => s.page.evaluate(() =>
  [...document.querySelectorAll('[data-testid^="allocation-row-"]')].map((r) => ({
    key: r.getAttribute('data-testid').replace('allocation-row-', ''),
    text: r.innerText.replace(/\n/g, ' ').slice(0, 70),
    checked: !!(r.querySelector('input[type="checkbox"]') || {}).checked,
  })));

const tickRow = (s, key, on = true) => s.page.evaluate(({ k, v }) => {
  const row = document.querySelector(`[data-testid="allocation-row-${k}"]`);
  const cb = row && row.querySelector('input[type="checkbox"]');
  if (!cb) return false;
  if (cb.checked !== v) cb.click();
  return cb.checked === v;
}, { k: key, v: on });

const footerText = (s) => s.page.evaluate(() => {
  const p = document.querySelector('[data-testid="allocation-picker"]');
  return p ? p.innerText.split('\n').pop() : null;
});

/** The panel's own success line after a receipt. */
const notice = (s) => s.page.evaluate(() => {
  const el = [...document.querySelectorAll('div,p,span')].filter((x) => x.offsetParent
    && /Receipt of|settled|left on account|no open bills/i.test(x.innerText || '') && (x.innerText || '').length < 240);
  return el.length ? el[el.length - 1].innerText.replace(/\n/g, ' ').trim() : null;
});

const callsSince = (s, from, frag) => s.net.slice(from)
  .filter((n) => n.method === 'POST' && n.url.includes(frag))
  .map((n) => ({ st: n.status, req: (() => { try { return JSON.parse(n.post_data || '{}'); } catch { return null; } })(), res: (n.response_body || '').slice(0, 400) }));

(async () => {
  const ev = {};
  const A = { token: await adminToken() };

  // ---- setup: one customer, three open credit bills, oldest first ----------
  const code = await issueCode(3, 4);
  const claimed = await api('POST', '/counters/claim', { code, device_uuid: `qa-g10-panel-${SUF}`, device_name: 'QA G10 panel probe' });
  if (claimed.status !== 200) throw new Error(`claim -> ${claimed.status} ${claimed.text.slice(0, 200)}`);
  const D = { device: claimed.json.device_token, token: claimed.json.device_token };

  const cust = await api('POST', '/admin/parties', { store_id: 4, type: 'customer', name: PARTY, credit_limit: 100000 }, { token: A.token, store: 4 });
  const cid = Number(cust.json?.party?.id ?? sql(`select id from parties where store_id=4 and name='${PARTY}'`)[0]?.id);
  const line = (grand) => {
    for (let q = 1; q <= 12; q++) if (grand % q === 0 && grand / q <= 120) return [{
      product_id: 6, product_name: 'QA Cough Syrup 100ml', batch_id: 7, batch_no: 'CS-A1',
      qty: q, loose_qty: 0, units_per_pack: 1, unit_price: grand / q, mrp: 120, gst_percent: 12, hsn_code: '30049011',
    }];
    throw new Error('no line lands on ' + grand);
  };
  const bills = {};
  for (const [tag, amount, date] of [['A', 300, '2026-10-28'], ['B', 200, '2026-10-29'], ['C', 100, '2026-10-30']]) {
    const r = await api('POST', '/invoices', {
      store_id: '4', external_id: `g10ui-${SUF}-${tag}`, idempotency_key: `g10ui-${SUF}-${tag}`,
      invoice_date: date, customer_name: PARTY, customer_id: cid, place_of_supply: '32-Kerala',
      tax_mode: 'inclusive', payment_mode: 'Credit', paid_amount: 0, payments: [{ mode: 'Credit', amount }],
      grand_total: amount, counter_code: 'C02', items: line(amount),
    }, D);
    const row = sql(`select id,invoice_number,grand_total,paid_amount,payment_status from invoices where external_id='g10ui-${SUF}-${tag}'`)[0];
    bills[tag] = { http: r.status, ...(row || {}) };
  }
  ev.setup = { party: cid, bills };
  check('UI-PAY-05setup', 'three credit bills for one customer are open, oldest first',
    ['A', 'B', 'C'].every((t) => bills[t].id && money(bills[t].paid_amount) === '0.00'),
    { party: PARTY, bills: ['A', 'B', 'C'].map((t) => [bills[t].invoice_number, bills[t].grand_total]) });

  const balOf = () => Number(sql(`select current_balance from parties where id=${cid}`)[0].current_balance);
  const paidOf = (t) => sql(`select paid_amount,payment_status from invoices where id=${bills[t].id}`)[0];
  const allocs = () => sql(`select pa.document_id,pa.amount,cp.notes from payment_allocations pa
      join customer_payments cp on cp.id=pa.payment_id where cp.customer_id=${cid} order by pa.id`);

  // ---- the panel ===========================================================
  const s = await newSession('g10_panel_ui', { url: ADMIN_URL });
  await sleep(2500);
  await s.typeInto('input[type=email]', 'admin@lamstone.in');
  await s.typeInto('input[type=password]', process.env.QA_ADMIN_PASS || 'Qa-Throwaway-2026!');
  await s.page.keyboard.press('Enter');
  await sleep(4000);
  await switchStore(s, 'QA-PH');
  await s.page.goto(ADMIN_URL + '/transactions', { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  const onTab = await s.clickText('Customer Receipts');
  await sleep(2000);
  const opened = await s.clickText('Record Customer Receipt');
  await sleep(2500);
  ev.modal_open = { tab: onTab, button: opened };

  // ---- receipt 1: the operator names one bill ==============================
  const picked = await pickOption(s, 'Outstanding:', String(cid));
  await sleep(1200);
  const amt1 = await typeIntoNthVisibleNumber(s, 0, '250.00');
  await sleep(1800);
  const rows1 = await pickerRows(s);
  const keyB = `invoice:${bills.B.id}`;
  const ticked = await tickRow(s, keyB);
  await sleep(900);
  const footer1 = await footerText(s);
  await s.screenshot('g10_panel_receipt_named');
  const n1 = s.net.length;
  const balBefore1 = balOf();
  await s.clickText('Record Receipt');
  await sleep(5000);
  const calls1 = callsSince(s, n1, '/admin/payments/customer');
  const msg1 = await notice(s);
  ev.receipt_named = { picked, amount_field: amt1, rows: rows1, ticked, footer: footer1,
    call: calls1[0] && { st: calls1[0].st, body: calls1[0].req, res: calls1[0].res }, notice: msg1,
    paid: { A: paidOf('A'), B: paidOf('B'), C: paidOf('C') }, allocs: allocs(), balance: [balBefore1, balOf()] };

  check('UI-PAY-05a', 'the receipt screen lists this customer\'s open bills with their outstanding amounts',
    rows1.length === 3 && rows1.map((r) => r.key).join() === [`invoice:${bills.A.id}`, `invoice:${bills.B.id}`, `invoice:${bills.C.id}`].join(),
    rows1);
  check('UI-PAY-05b', 'the receipt posts an explicit allocation for the bill that was ticked, and only that one',
    calls1.length === 1 && calls1[0].st < 300 && Array.isArray(calls1[0].req?.allocations)
      && calls1[0].req.allocations.length === 1
      && Number(calls1[0].req.allocations[0].invoice_id) === bills.B.id && money(calls1[0].req.allocations[0].amount) === '200.00',
    { http: calls1.map((c) => c.st), allocations: calls1[0] && calls1[0].req?.allocations, footer: footer1, notice: msg1 });
  check('UI-PAY-05c', 'the named bill is the one that moved: B settled, A and C still open',
    money(paidOf('B').paid_amount) === '200.00' && money(paidOf('A').paid_amount) === '0.00' && money(paidOf('C').paid_amount) === '0.00',
    { A: paidOf('A'), B: paidOf('B'), C: paidOf('C'), allocs: allocs() });
  check('UI-PAY-05d', 'the ₹250 left the balance once, ₹50 of it stays on account',
    Math.abs((balBefore1 - balOf()) - 250) < 0.01 && allocs().length === 1 && money(allocs()[0].amount) === '200.00',
    { before: balBefore1, after: balOf(), allocs: allocs() });

  // ---- receipt 2: nothing ticked, the server's FIFO decides ===============
  await s.clickText('Record Customer Receipt');
  await sleep(2000);
  await pickOption(s, 'Outstanding:', String(cid));
  await sleep(1200);
  await typeIntoNthVisibleNumber(s, 0, '260.00');
  await sleep(1600);
  const rows2 = await pickerRows(s);
  const footer2 = await footerText(s);
  const n2 = s.net.length;
  const balBefore2 = balOf();
  await s.clickText('Record Receipt');
  await sleep(5000);
  const calls2 = callsSince(s, n2, '/admin/payments/customer');
  const msg2 = await notice(s);
  await s.screenshot('g10_panel_receipt_fifo');
  ev.receipt_fifo = { rows: rows2, footer: footer2, notice: msg2, call: calls2[0] && { st: calls2[0].st, body: calls2[0].req },
    paid: { A: paidOf('A'), B: paidOf('B'), C: paidOf('C') }, allocs: allocs(), balance: [balBefore2, balOf()] };

  check('UI-PAY-05e', 'with no bill ticked the receipt sends no allocations and says so',
    calls2.length === 1 && calls2[0].st < 300 && calls2[0].req?.allocations === undefined
      && /oldest/i.test(footer2 || ''),
    { http: calls2.map((c) => c.st), body: calls2[0] && calls2[0].req, footer: footer2 });
  check('UI-PAY-05f', 'the server then clears the oldest open bill (A) with all ₹260',
    money(paidOf('A').paid_amount) === '260.00' && /partial/i.test(paidOf('A').payment_status)
      && allocs().some((r) => Number(r.document_id) === bills.A.id && money(r.amount) === '260.00'),
    { A: paidOf('A'), B: paidOf('B'), C: paidOf('C'), allocs: allocs(), balance: [balBefore2, balOf()] });

  await s.close();
  evidence('G10_panel_ui', ev);
  const failed = T.filter((t) => !t.ok);
  console.log(`\n${T.length - failed.length}/${T.length} panel checks passed`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.id).join(', '));
})().catch((e) => { console.error('panel probe error:', e.message); process.exit(1); });
