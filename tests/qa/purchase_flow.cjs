/**
 * Reusable purchase-inward UI flow, extracted from the S3 run that posted successfully.
 *
 * Every session gets a throwaway Chrome profile (driver.cjs:40-43, stable:false), so the
 * till's localStorage-backed tables are empty at login. Any scenario that needs an
 * existing purchase has to create it here, in the same session.
 *
 * Posting goes through the button, never F12: the global capture-phase dispatcher claims
 * F12 as "Switch Account" (centralKeyMap.ts:121) because production registers no
 * `purchase` scope.
 */
const {
  sleep, navTo, readGrid, setInput, draftRowText, addDraftProduct, setDraftBatch, setDraftField,
} = require('./gst_kit.cjs');

const GRID = 'table[aria-label="Purchase Inward Items"]';

/** Purchase footer summary strip: Subtotal / GST Tax / Round / Net Payable. */
async function readPurchaseTotals(s) {
  const t = await s.text();
  const num = (re) => { const m = t.match(re); return m ? Number(m[1].replace(/[^0-9.\-]/g, '')) : null; };
  return {
    subtotal: num(/Subtotal:\s*₹\s*([\d,.]+)/i),
    tax: num(/(?:IGST|GST) Tax:\s*₹\s*([\d,.]+)/i),
    round_off: num(/Round:\s*[+-]?₹\s*([\d,.]+)/i),
    net_payable: num(/Net Payable\s*₹\s*([\d,.]+)/i),
  };
}

/** Everything the post gates read, plus any overlay sitting on top of the form. */
function headerState(s) {
  return s.page.evaluate(() => {
    const val = (re) => {
      const el = [...document.querySelectorAll('input')].find(e => e.offsetParent !== null && re.test(e.placeholder || ''));
      return el ? el.value : null;
    };
    const btn = [...document.querySelectorAll('button')].find(b =>
      b.offsetParent !== null && (b.innerText || '').replace(/\s+/g, ' ').trim().startsWith('Post Purchase'));
    return {
      supplier: val(/select or search supplier/i),
      vendor_bill_no: val(/^INV-001$/),
      post_button: btn ? { text: (btn.innerText || '').replace(/\s+/g, ' ').trim(), disabled: btn.disabled } : null,
      tbody_rows: document.querySelectorAll('table[aria-label="Purchase Inward Items"] tbody tr').length,
      overlays: [...document.querySelectorAll('[role="dialog"]')].map(e => (e.innerText || '').replace(/\s+/g, ' ').slice(0, 60)),
      switcher_open: /Switch Counter Cashier|Switch Account/i.test(document.body.innerText),
      post_modal_in_dom: /Confirm & Post Purchase/.test(document.body.innerText),
    };
  });
}

/** Close the "Switch Counter Cashier" overlay without touching the form's own Cancel. */
function closeSwitcher(s) {
  return s.page.evaluate(() => {
    const hosts = [...document.querySelectorAll('div')]
      .filter(d => /Switch Counter Cashier|Switch Account/i.test(d.innerText || ''))
      .sort((a, b) => a.innerText.length - b.innerText.length);
    for (const h of hosts) {
      const btn = [...h.querySelectorAll('button')].find(b => /^(cancel|close)$/i.test((b.innerText || '').trim()));
      if (btn) { btn.click(); return true; }
    }
    return false;
  });
}

async function pickSupplier(s, name) {
  const sel = await s.page.evaluate(() => {
    const el = [...document.querySelectorAll('input[role="combobox"]')]
      .find(e => e.offsetParent !== null && /select or search supplier/i.test(e.placeholder || ''));
    if (!el) return null;
    el.setAttribute('data-qa-sup', '1');
    return 'input[data-qa-sup="1"]';
  });
  if (!sel) return { ok: false, why: 'no supplier combobox' };
  await s.page.click(sel);
  await sleep(500);
  await s.page.keyboard.type(name, { delay: 40 });
  await sleep(2200);
  const opt = await s.page.evaluate((n) => {
    const el = [...document.querySelectorAll('[role="option"]')].find(e => e.offsetParent !== null && (e.innerText || '').includes(n));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 70) };
  }, name);
  if (opt) { await s.page.mouse.click(opt.x, opt.y); await sleep(1800); }
  else await s.key('Enter');
  await sleep(1000);
  const value = await s.page.evaluate(() => { const el = document.querySelector('input[data-qa-sup="1"]'); return el ? el.value : null; });
  return { ok: !!value && value.toLowerCase().includes('supplier'), value, clicked_option: opt ? opt.text : 'enter' };
}

/** Committed lines for one product (the empty-state placeholder row never matches a name). */
async function committedRows(s) {
  const grid = await readGrid(s, GRID);
  return grid.rows.filter(r => r.length > 1);
}

/** One draft row built in <tfoot> and promoted by Enter on the selling-rate box. */
async function addPurchaseLine(s, prod, { batch, expiry, packs, rate }) {
  const before = (await committedRows(s)).length;
  const step = {};
  step.product = await addDraftProduct(s, prod.name);
  if (!step.product.ok) return { ...step, ok: false };
  step.batch = await setDraftBatch(s, batch);
  step.expiry = await setDraftField(s, 'MM/YY', expiry);
  step.expiry.ok = !!step.expiry.after;
  step.qty = await setDraftField(s, 'Packs', packs);
  step.rate = await setDraftField(s, 'Rate', rate);
  step.draft_before_commit = await draftRowText(s);
  step.sell = await setDraftField(s, 'Sell', String(Math.round(rate * 1.2)));
  await sleep(1500);
  const rows = await committedRows(s);
  step.committed_row = rows[rows.length - 1] || null;
  step.toast = (await s.text()).match(/(Please specify [^\n]{0,40}|Invalid expiry[^\n]{0,40}|Cannot inward expired[^\n]{0,40}|must be before[^\n]{0,40}|HSN\/SAC[^\n]{0,40})/);
  step.ok = rows.length === before + 1;
  return step;
}

async function clickPost(s, toastSeen, label) {
  const clicked = await s.page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find(b =>
      b.offsetParent !== null && (b.innerText || '').replace(/\s+/g, ' ').trim().startsWith('Post Purchase'));
    if (!el) return false;
    el.click();
    return true;
  });
  for (let i = 0; i < 14; i++) {
    await sleep(250);
    const t = await s.page.evaluate(() => {
      const el = [...document.querySelectorAll('div')].find(d => String(d.className).includes('9999'));
      return el ? (el.innerText || '').replace(/\s+/g, ' ').trim() : null;
    });
    if (t && !toastSeen.includes(t)) {
      toastSeen.push(t);
      console.log(`  toast(${label}): ${t}`);
    }
    const open = await s.page.evaluate(() => /Confirm & Post Purchase/.test(document.body.innerText));
    if (open) return true;
  }
  return clicked ? 'no-modal' : false;
}

/** Entry-form state, read past the "Purchase Bill Posted!" modal that blocks the form. */
function formState(s) {
  return s.page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b =>
      b.offsetParent !== null && (b.innerText || '').replace(/\s+/g, ' ').trim().startsWith('Post Purchase'));
    const m = document.body.innerText.match(/ITEMS:\s*\n?\s*(\d+)/i);
    return {
      post_button: !!btn,
      post_disabled: btn ? !!btn.disabled : null,
      success_modal: /Purchase Bill Posted!/i.test(document.body.innerText),
      empty_list: /Inward bill items list is empty/i.test(document.body.innerText),
      items_count: m ? Number(m[1]) : null,
    };
  });
}

/** Dismiss PurchasePostSuccessModal through its own Close control. */
function closePostSuccessModal(s) {
  return s.page.evaluate(() => {
    const hosts = [...document.querySelectorAll('div')].filter(d =>
      /Purchase Bill Posted!/.test(d.innerText || '') && /Start New Purchase Bill/.test(d.innerText || ''));
    const host = hosts.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!host) return false;
    const x = [...host.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '') === 'Close');
    if (!x) return false;
    x.click();
    return true;
  });
}

/**
 * Get to a clean, empty inward-entry form. A post leaves the PurchasePostSuccessModal on
 * top of the form, and its "Start New Purchase Bill" is the only control that both closes
 * it and resets the draft — typing behind the modal silently goes nowhere.
 */
async function openFreshEntryForm(s) {
  const trace = [];
  await navTo(s, '/purchases');
  await sleep(2500);
  let st = await formState(s);
  trace.push(st);
  if (st.success_modal) {
    // the designed reset path: it closes the modal AND empties the draft
    await s.clickText('Start New Purchase Bill');
    await sleep(3000);
    st = await formState(s);
    trace.push({ after_new_bill: st });
  } else if (!st.post_button || !st.empty_list) {
    // dashboard, or a form still holding the previous bill's lines
    await s.clickText('New Inward Bill');
    await sleep(3000);
    st = await formState(s);
    trace.push({ after_open: st });
  }
  return { ok: st.post_button && (st.empty_list || st.items_count === 0) && !st.success_modal, state: st, trace };
}

/**
 * Full inward bill: header, lines, post, confirm. Returns the UI totals and whether the
 * confirm actually ran, so the caller can judge the document itself.
 */
async function postPurchaseInward(s, { lines, supplier, vendorBill, settle = true, label = 'bill' }) {
  const result = { label, vendor_bill: vendorBill, steps: [], toasts: [] };
  const opened = await openFreshEntryForm(s);
  result.form_before_lines = opened.state;
  result.form_open_trace = opened.trace;
  if (!opened.ok) return { ...result, ok: false, why: 'could not reach an empty entry form' };

  result.supplier = await pickSupplier(s, supplier);
  result.vendor_bill_set = await setInput(s, 'input[placeholder="INV-001"]', vendorBill);

  for (const l of lines) {
    const step = await addPurchaseLine(s, l.prod, l);
    result.steps.push({ product: l.prod.name, batch: l.batch, packs: l.packs, rate: l.rate, ok: step.ok, committed_row: step.committed_row, toast: step.toast, draft: step.draft_before_commit, product_pick: step.product, batch_set: step.batch });
    console.log(`  ${label} line ${l.prod.name}: committed=${step.ok}`);
    if (!step.ok) {
      result.failed_line = l.prod.name;
      result.grid = await readGrid(s, GRID);
      result.diagnosis = await s.page.evaluate(() => ({
        screen: document.body.innerText.replace(/\n{3,}/g, '\n').slice(-900),
        buttons: [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null)
          .map(b => (b.innerText || '').replace(/\s+/g, ' ').trim()).filter(x => x).slice(0, 40),
        tfoot_inputs: [...document.querySelectorAll('table tfoot input, table tfoot [role="combobox"]')]
          .map(e => ({ ph: e.placeholder, value: e.value })),
        options_open: [...document.querySelectorAll('[role="option"]')].map(e => (e.innerText || '').replace(/\s+/g, ' ').slice(0, 40)).slice(0, 8),
      }));
      return { ...result, ok: false, why: 'draft line not committed' };
    }
  }

  result.totals = await readPurchaseTotals(s);
  result.pre_post = await headerState(s);

  let modalOpen = await clickPost(s, result.toasts, `${label} first`);
  if (modalOpen !== true) {
    // Escape is deliberately not pressed: it raises "Close purchase bill entry?" and
    // takes the form away. Re-pick whatever the gate reported empty.
    const stuck = await headerState(s);
    if (stuck.switcher_open) await closeSwitcher(s);
    await sleep(600);
    if (!stuck.supplier) result.supplier_repick = await pickSupplier(s, supplier);
    if (!stuck.vendor_bill_no) await setInput(s, 'input[placeholder="INV-001"]', vendorBill);
    result.retry_from = await headerState(s);
    modalOpen = result.retry_from.post_button ? await clickPost(s, result.toasts, `${label} retry`) : false;
    result.post_attempts = 2;
  } else {
    result.post_attempts = 1;
  }

  if (modalOpen !== true) {
    result.grid = await readGrid(s, GRID);
    return { ...result, ok: false, why: `post modal never opened (${modalOpen})`, post_modal_open: modalOpen };
  }

  result.confirm_click = await s.clickText('Confirm & Post Purchase');
  await sleep(12000);
  result.after_post_screen = (await s.text()).replace(/\n{3,}/g, '\n').slice(-500);
  result.post_success_modal = (await formState(s)).success_modal;
  // the modal is left open on purpose: closing it with its X keeps the posted lines in the
  // form, while "Start New Purchase Bill" (handled by the next openFreshEntryForm) resets.
  if (settle) await sleep(4000);
  return { ...result, ok: !!result.confirm_click, post_modal_open: modalOpen };
}

module.exports = { postPurchaseInward, readPurchaseTotals, headerState, formState, openFreshEntryForm, closePostSuccessModal, closeSwitcher, pickSupplier, addPurchaseLine, committedRows, GRID };
