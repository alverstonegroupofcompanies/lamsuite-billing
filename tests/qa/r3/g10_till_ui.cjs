/**
 * G10-PAYMENTS at the till: drives the real POS screen, not the API.
 *   QA_BACKEND=http://127.0.0.1:8100 QA_DB=g10.sqlite QA_POS_URL=http://localhost:5176 node g10_till_ui.cjs
 * Screenshots + evidence JSON only; every money claim is read back from the DB.
 */
const { claim } = require('./pos.cjs');
const { sql, evidence, sleep, api, adminToken } = require('./lib.cjs');

const T = [];
const check = (id, desc, ok, detail) => {
  T.push({ id, desc, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}  ${desc}  ${JSON.stringify(detail ?? null).slice(0, 260)}`);
};
const money = (v) => Number(v).toFixed(2);
const note = (msg) => console.log(`NOTE  ${msg}`);
// Every fixture this script writes is named per run: a second pass must read its
// own rows, not the first pass's, or a queued-but-unsynced document looks like a pass.
const SUF = Date.now().toString(36);

const nav = async (s, label) => {
  const ok = await s.clickText(label);
  await sleep(2500);
  if (!ok) throw new Error(`nav "${label}" not found`);
};

async function addItem(s, name, packs) {
  await s.page.keyboard.press('F1'); await sleep(1200);
  await s.page.keyboard.type(name, { delay: 30 }); await sleep(1800);
  await s.page.keyboard.press('Enter'); await sleep(1400);   // product row -> batch picker
  await s.page.keyboard.press('Enter'); await sleep(1400);   // FEFO batch -> line at qty 1, focus in its qty box
  if (packs !== 1) {
    await s.page.evaluate(() => { const el = document.activeElement; if (el && el.select) el.select(); });
    await s.page.keyboard.type(String(packs), { delay: 35 }); await sleep(600);
  }
  await s.page.keyboard.press('Enter'); await sleep(1400);
}

const summary = async (s) => s.page.evaluate(() => {
  const out = {};
  for (const el of document.querySelectorAll('span, div')) {
    const label = (el.innerText || '').trim().toLowerCase();
    if (!['total due', 'paid so far', 'change due', 'balance remaining', 'non-cash overpaid', 'settlement status'].includes(label)) continue;
    const value = el.parentElement && el.parentElement.querySelector('p');
    if (value) out[label] = (value.innerText || '').trim();
  }
  return out;
});

/** Type into the nth tender amount box (the modal's 0.00 inputs), like a user. */
async function typeTender(s, nth, value) {
  const found = await s.page.evaluate((n) => {
    const el = [...document.querySelectorAll('input[placeholder="0.00"]')].filter((i) => i.type === 'number')[n];
    if (!el) return null;
    el.focus();
    el.select();
    return el.value;
  }, nth);
  if (found === null) return false;
  await s.page.keyboard.press('Backspace');
  await s.page.keyboard.type(String(value), { delay: 25 });
  await sleep(500);
  return s.page.evaluate((n) => {
    const el = [...document.querySelectorAll('input[placeholder="0.00"]')].filter((i) => i.type === 'number')[n];
    return el ? el.value : null;
  }, nth);
}

/**
 * The tender line's own mode dropdown. React swallows a direct `select.value`
 * write (its value tracker then reports "no change"), so flip the option and
 * dispatch change the way picking it in the popup does.
 */
async function pickTenderMode(s, mode) {
  const done = await s.page.evaluate((m) => {
    const el = [...document.querySelectorAll('select')].find((x) =>
      [...x.options].some((o) => o.value === 'Gift Voucher') && [...x.options].some((o) => o.value === m));
    if (!el) return false;
    const opt = [...el.options].find((o) => o.value === m);
    opt.selected = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, mode);
  if (!done) return null;
  await sleep(900);
  return s.page.evaluate(() => {
    const el = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'Gift Voucher'));
    if (!el) return null;
    const line = el.closest('div[class*="rounded-lg"]');
    const ref = line && line.querySelector('input[type="text"]');
    return { mode: el.value, ref_placeholder: ref ? ref.placeholder : null };
  });
}

/** Focus the reference box that belongs to the tender line, like a user. */
const focusTenderRef = (s) => s.page.evaluate(() => {
  const el = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'Gift Voucher'));
  const line = el && el.closest('div[class*="rounded-lg"]');
  const ref = line && line.querySelector('input[type="text"]');
  if (!ref) return null;
  ref.focus();
  return ref.placeholder;
});

const tenderLines = (s, invoiceId) => invoiceId
  ? sql(`select payment_mode,amount,tendered_amount,change_amount,reference_no from invoice_payments where invoice_id=${invoiceId} order by id`)
  : [];

const newestBillId = () => Number(sql('select coalesce(max(id),0) m from invoices')[0].m);
const billAfter = (id) => sql(`select id,invoice_number,store_id,grand_total,paid_amount,payment_status,payment_mode from invoices where id>${id} order by id desc limit 1`)[0];

async function combo(s, mods, key) {
  for (const m of mods) await s.page.keyboard.down(m);
  await s.page.keyboard.press(key);
  for (const m of [...mods].reverse()) await s.page.keyboard.up(m);
}

/** The lines the till actually put on the wire, read out of the POST body. */
const sentPayments = (calls) => calls.map((c) => {
  try { return JSON.parse(c.req); } catch { return null; }
}).filter(Boolean).map((b) => ({ paid: b.paid_amount, payments: b.payments }));

const invoicePosts = (s, from) => s.net.slice(from).filter((n) => /\/invoices$/.test(n.url) && n.method === 'POST')
  .map((n) => ({ st: n.status, req: (n.post_data || '').slice(0, 6000), res: (n.response_body || '').slice(0, 400) }));

async function saveBill(s) {
  const n0 = s.net.length;
  await combo(s, ['Control'], 'KeyS');
  await sleep(6000);
  return invoicePosts(s, n0);
}

/**
 * Click the footer Save button instead of Ctrl+S. The hotkey runs through a
 * keydown listener whose closure is not re-made when the tender lines change
 * (PosBillingPage.tsx:1905 deps), so a mode picked after the modal opened is
 * saved as the mode the line had before it — the button uses the live render.
 */
async function saveBillByButton(s) {
  const n0 = s.net.length;
  const clicked = await s.page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^Save \(Ctrl\+S\)/i.test((x.innerText || '').trim()));
    if (!b) return false;
    b.click();
    return true;
  });
  if (!clicked) throw new Error('Save button not found on the tender panel');
  await sleep(6000);
  return invoicePosts(s, n0);
}

(async () => {
  const ev = {};
  const s = await claim('g10_till_ui', 3, 4);
  await nav(s, 'POS Billing');

  // ===== PAY-02  a ₹500 note on a smaller bill ==============================
  await addItem(s, 'QA Cough Syrup', 1);
  await s.page.keyboard.press('F12'); await sleep(1500);
  const t0 = await summary(s);
  const due = Number((t0['total due'] || '0').replace(/[^\d.]/g, ''));
  const tendered = due + 290;
  const typed02 = await typeTender(s, 0, tendered.toFixed(2));
  const t1 = await summary(s);
  await s.screenshot('g10_till_02_over_tender');
  const before02 = newestBillId();
  const calls02 = await saveBill(s);
  const bill02 = billAfter(before02);
  ev.pay02 = { summary_before: t0, summary_after_type: t1, calls: calls02, bill: bill02, lines: tenderLines(s, bill02 && bill02.id) };
  check('UI-PAY-02a', `the tender panel shows ₹${tendered} tendered as change due ₹290 on a ₹${due} bill`,
    Number(String(typed02).replace(/[^\d.]/g, '')) === tendered && /290\.00/.test(t1['change due'] || '') && !/Blocked/.test(t1['non-cash overpaid'] || ''),
    { typed: typed02, summary: t1 });
  const sent02 = sentPayments(calls02);
  check('UI-PAY-02b', 'the till posts the applied amount, not the note',
    calls02.length === 1 && calls02[0].st < 300 && sent02.length === 1
      && money(sent02[0].payments[0].amount) === money(due) && money(sent02[0].paid) === money(due),
    { http: calls02.map((c) => c.st), sent: sent02 });
  check('UI-PAY-02c', 'the bill header and tender row agree: collected = bill, note and change recorded',
    bill02 && money(bill02.paid_amount) === money(due) && money(bill02.grand_total) === money(due)
      && ev.pay02.lines[0] && money(ev.pay02.lines[0].amount) === money(due)
      && money(ev.pay02.lines[0].tendered_amount) === money(tendered)
      && money(ev.pay02.lines[0].change_amount) === '290.00',
    { bill: bill02 && [bill02.invoice_number, bill02.grand_total, bill02.paid_amount], lines: ev.pay02.lines });

  // ===== PAY-03  a walk-in bill cannot be saved half paid ===================
  await sleep(1500);
  const base03 = newestBillId();
  await addItem(s, 'QA Cough Syrup', 1);
  await s.page.keyboard.press('F12'); await sleep(1200);
  const typed03 = await typeTender(s, 0, '10.00');
  const t2 = await summary(s);
  await s.screenshot('g10_till_03_balance');
  const calls03 = await saveBill(s);
  const sent03 = sentPayments(calls03);
  const saved03 = sql(`select id,invoice_number,grand_total,paid_amount,payment_status,customer_name from invoices where id>${base03} order by id`);
  const refused03 = calls03.find((c) => c.st === 422);
  const toppedUp03 = !refused03 && saved03.length === 1
    && money(saved03[0].paid_amount) === money((t2['total due'] || '0').replace(/[^\d.]/g, ''))
    && Number((t2['balance remaining'] || '0').replace(/[^\d.]/g, '')) > 0.005;
  ev.pay03 = { summary: t2, calls: calls03, sent: sent03, bills: saved03, topped_up: toppedUp03,
    screen: (await s.text()).split('\n').filter((l) => /walk|full|balance|reference|settled/i.test(l)).slice(0, 8) };
  check('UI-PAY-03a', 'the panel says what is still owed instead of pretending it is paid',
    Number(String(typed03).replace(/[^\d.]/g, '')) === 10 && Number((t2['balance remaining'] || '0').replace(/[^\d.]/g, '')) > 0,
    { typed: typed03, summary: t2 });
  check('UI-PAY-03b', 'a walk-in bill never leaves this till half paid: the save is refused, or nothing short is booked',
    refused03 ? /walk-in|full/i.test(refused03.res) : saved03.every((b) => money(b.paid_amount) === money(b.grand_total)),
    { http: calls03.map((c) => c.st), refused: refused03 && refused03.res.slice(0, 180), sent: sent03,
      bills: saved03.map((b) => [b.invoice_number, b.grand_total, b.paid_amount, b.payment_status]) });
  check('UI-PAY-03c', 'no unpaid walk-in bill was left behind', saved03.every((b) => b.payment_status === 'paid'),
    { bills: saved03.map((b) => [b.invoice_number, b.payment_status]) });
  if (toppedUp03) {
    note(`UI-PAY-03 the till's own protection is a silent top-up: ₹10 typed in the cash box was booked as ${money(saved03[0].paid_amount)}. `
      + 'Pre-existing shipped behaviour (PosBillingPage auto-fill), left unchanged by G10 — the server rule that refuses a short walk-in bill '
      + 'is reached by the API, the sync queue and any other client, not by this path.');
  }

  // ===== PAY-04  UPI without a reference ====================================
  // A second till, on the store that never saved its own reference rule, so the
  // new default is the rule under test.
  // QA setup only: this throwaway store's single product had gone out of stock
  // (negative batch), which makes another group's sell-beyond-stock approval gate
  // answer the save instead of the rule under test. The DB copy is topped up and
  // the gate is switched off here so the reference policy is what is observed.
  const A = { token: await adminToken() };
  const prof = await api('GET', '/admin/counters/1/profile', undefined, { token: A.token, store: 2 });
  const doc = prof.json?.profile?.permissions || {};
  ev.profile_setup = {
    http: prof.status,
    put: (await api('PUT', '/admin/counters/1/profile', {
      profile: { ...doc, sell_beyond_stock: { allowed: true, approval_required: false } },
    }, { token: A.token, store: 2 })).status,
  };
  const s2 = await claim('g10_till_ui_ref', 1, 2);
  await nav(s2, 'POS Billing');

  // ---- the hotkey path, kept as evidence of a separate till defect ---------
  await addItem(s2, 'Kochi Exclusive Wellness Tonic', 1);
  await s2.page.keyboard.press('F12'); await sleep(1400);
  const hotkeyState = await pickTenderMode(s2, 'UPI');
  const baseHot = newestBillId();
  const callsHot = await saveBill(s2);
  const billHot = billAfter(baseHot);
  ev.pay04_hotkey = { line_state: hotkeyState, calls: callsHot.map((c) => ({ st: c.st, pay: (c.req.match(/"payments":\[[^\]]*\]/) || [''])[0] })),
    bill: billHot, lines: tenderLines(s2, billHot && billHot.id) };
  if (hotkeyState && hotkeyState.mode === 'UPI' && billHot && /Cash/i.test(billHot.payment_mode)) {
    note('NEW DEFECT (reported, not fixed by G10): with the tender line on UPI, Ctrl+S saved '
      + `${billHot.invoice_number} as ${billHot.payment_mode} with no reference. The save hotkey runs from a keydown `
      + 'listener that is not re-registered when the tender lines change, so it posts the lines as they were when the '
      + 'modal opened. The same bill saved from the footer Save button keeps UPI and the reference.');
  }

  await addItem(s2, 'Kochi Exclusive Wellness Tonic', 1);
  await s2.page.keyboard.press('F12'); await sleep(1400);
  const tPre = await summary(s2);
  const due2 = Number((tPre['total due'] || '0').replace(/[^\d.]/g, ''));
  if (!(due2 > 0)) throw new Error(`store 2 bill has no payable total: ${JSON.stringify(tPre)}`);
  // Change this tender line's mode with its own dropdown, not the quick-mode
  // grid: the grid also matches a UPI button elsewhere on the screen.
  const modeState = await pickTenderMode(s2, 'UPI');
  const modeSwitched = !!(modeState && modeState.mode === 'UPI');
  const refBoxShown = !!(modeState && modeState.ref_placeholder);
  const tenderValue04 = await typeTender(s2, 0, due2.toFixed(2));
  const t3 = await summary(s2);
  const base04 = newestBillId();
  const calls04 = await saveBillByButton(s2);
  const screen04 = (await s2.text()).split('\n').filter((l) => /reference|UTR|required|blocked/i.test(l)).slice(0, 6);
  ev.pay04 = { due: due2, mode_state: modeState, typed: tenderValue04, summary: t3, calls: calls04, screen: screen04 };
  // The till stops an unreferenced UPI line itself (billingTenderService
  // validatePaymentLines); if a client ever posts one, the server 422 is the
  // second half of the same rule. Either way the bill must not be created.
  const blocked04 = calls04.length === 0 || calls04.some((c) => c.st === 422 && /reference|UTR/i.test(c.res));
  check('UI-PAY-04a', 'a UPI line with no reference is stopped at save and no bill is written',
    modeSwitched && refBoxShown && blocked04 && newestBillId() === base04,
    { due: due2, mode: modeState, typed: tenderValue04, http: calls04.map((c) => c.st),
      res: (calls04.find((c) => c.st >= 300) || { res: '' }).res.slice(0, 200), screen: screen04 });

  const refTyped = await focusTenderRef(s2);
  if (refTyped) await s2.page.keyboard.type('UTRG10UI77889', { delay: 20 });
  await sleep(500);
  const refValue = await s2.page.evaluate(() => {
    const el = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'Gift Voucher'));
    const line = el && el.closest('div[class*="rounded-lg"]');
    const ref = line && line.querySelector('input[type="text"]');
    return ref ? { placeholder: ref.placeholder, value: ref.value } : null;
  });
  const calls04b = await saveBillByButton(s2);
  await s2.close();
  const bill04 = sql(`select id,invoice_number,grand_total,paid_amount,payment_mode,external_id from invoices where id>${base04} order by id desc limit 1`)[0];
  ev.pay04.with_ref = { field: refTyped, value_in_field: refValue, calls: calls04b, bill: bill04, lines: tenderLines(s2, bill04 && bill04.id) };
  check('UI-PAY-04b', 'the same bill saves once the UTR is typed, as a referenced UPI tender',
    calls04b.some((c) => c.st < 300) && bill04 && /UPI/i.test(bill04.payment_mode)
      && ev.pay04.with_ref.lines.some((l) => l.reference_no === 'UTRG10UI77889'),
    { http: calls04b.map((c) => c.st), field: refValue, bill: bill04 && bill04.invoice_number, lines: ev.pay04.with_ref.lines });

  // ===== EXP-01  the drawer's own expenses screen ===========================
  // SHF-01 has no till surface: this drawer panel is the offline engine's local
  // book, so the shift endpoints are covered by the API probe, not here.
  await nav(s, 'Expenses');
  const hasScreen = /Record an expense/i.test(await s.text());
  const expHead = `QA G10 UI ${SUF}`;
  const headTyped = await s.typeByPlaceholder('e.g. Tea', expHead);
  const amountFocused = await s.page.evaluate(() => {
    const el = [...document.querySelectorAll('input[type="number"]')].find((i) => /amount/i.test((i.closest('label') || {}).innerText || ''));
    if (!el) return false;
    el.focus(); el.select();
    return true;
  });
  if (amountFocused) await s.page.keyboard.type('60', { delay: 30 });
  await sleep(600);
  ev.expense_form = { headTyped, amountFocused, head: expHead };
  const expBefore = sql(`select count(*) n from expenses where expense_head='${expHead}'`)[0].n;
  const nExp = s.net.length;
  await s.page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Record expense/i.test(x.innerText || ''));
    if (b) b.click();
  });
  // The till queues the expense and flushes it on its own sync tick, so wait for
  // this run's row instead of reading whatever the previous run left behind.
  let expRow = null;
  for (let i = 0; i < 12 && !expRow; i++) {
    await sleep(5000);
    expRow = sql(`select id,expense_number,store_id,counter_id,expense_head,amount,payment_mode from expenses where expense_head='${expHead}' order by id desc limit 1`)[0] || null;
  }
  ev.expense = {
    has_screen: hasScreen, calls: s.net.slice(nExp).filter((n) => /expenses/.test(n.url)).map((n) => ({ m: n.method, u: n.url, st: n.status, body: (n.post_data || '').slice(0, 300), res: (n.response_body || '').slice(0, 200) })),
    row: expRow, screen: (await s.text()).split('\n').filter((l) => /expense|recorded|saved|required|denied|permitted/i.test(l)).slice(0, 10),
  };
  check('UI-EXP-01a', 'the till shows an Expenses screen', hasScreen, ev.expense.screen.slice(0, 4));
  check('UI-EXP-01b', 'this run\'s expense reaches the counter drawer it was typed at',
    expRow && expRow.expense_head === expHead && Number(expRow.counter_id) === 3
      && money(expRow.amount) === '60.00' && expRow.store_id === 4,
    { before: expBefore, row: expRow, calls: ev.expense.calls.map((c) => [c.m, c.st]) });

  await s.screenshot('g10_till_expense_saved');
  await s.close();
  evidence('G10_till_ui', ev);
  const failed = T.filter((t) => !t.ok);
  console.log(`\n${T.length - failed.length}/${T.length} till-UI checks passed`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.id).join(', '));
})().catch((e) => { console.error('till ui probe error:', e.message); process.exit(1); });
