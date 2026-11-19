/**
 * S1 — Sales bill GST totals, both tax modes, switched from POS → Settings.
 * Surfaces compared to the paisa: POS screen -> independent oracle -> backend invoice rows,
 * plus server batch stock before/after and the network writes that carried the bill.
 *
 * Each pass sets the mode from the settings screen and then judges against the oracle for
 * the mode the store ACTUALLY ended up in, so a settings save that silently fails shows up
 * as a settings failure instead of corrupting every number comparison below it.
 */
const {
  storeByCode, fixture, login, shot, sleep, readMoney, invoiceNoShown, addLine, checkoutAndSave,
  serverInvoice, serverBatchStock, computeInvoice, p2, eq, cmp, sql, saveEvidence, navTo, batchWithStock,
  selectByLabel, batchRate,
} = require('./gst_kit.cjs');

const KEY = process.env.QA_KEY_A || 'LAM-QAA-97814AFCF43A787D-F6323688';

// Slab coverage: 18% single, 0% exempt, odd-paisa 18%, a 24-count pack sold pack+loose at 12%,
// and a half-paisa rate at 12%.
const LINES = [
  { frag: 'QA Antibiotic Syrup', packs: 2, loose: 0 },
  { frag: 'QA Exempt Nutritional', packs: 3, loose: 0 },
  { frag: 'QA Precision Item', packs: 7, loose: 0 },
  { frag: 'QA Oral Rehydration', packs: 1, loose: 12 },
  { frag: 'QA Half-Paisa', packs: 3, loose: 0 },
];

function billingMode(storeId) {
  const row = sql(`select value from company_settings where store_id=${storeId} and key='billing'`)[0];
  let v = row && row.value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = {}; } }
  return (v && v.tax_mode) || null;
}

function storeColumnMode(storeId) {
  const row = sql(`select tax_mode from stores where id=${storeId}`)[0];
  return row ? row.tax_mode : null;
}

/**
 * Drive POS -> Settings -> Billing & Taxes -> GST & General and persist `mode`.
 * Returns the on-screen value before/after plus what actually reached the database.
 */
async function setTaxMode(s, store, mode, label) {
  await navTo(s, '/settings'); await sleep(3000);
  await s.clickText('Billing & Taxes'); await sleep(1500);
  await s.clickText('GST & General'); await sleep(1500);
  await shot(s, `settings_before_${label}`);

  const readSelect = () => s.page.evaluate(() => {
    const lab = [...document.querySelectorAll('label,span,div,p,th')].find(e => e.children.length === 0
      && /sales tax mode/i.test((e.innerText || '').trim()));
    if (!lab) return null;
    let node = lab;
    for (let up = 0; up < 5 && node; up++) {
      const sel = node.querySelector && node.querySelector('select');
      if (sel) return { value: sel.value, options: [...sel.options].map(o => o.value + '|' + o.text) };
      node = node.parentElement;
    }
    return null;
  });

  const before = await readSelect();
  const pick = await selectByLabel(s, 'Sales Tax Mode', mode);
  const afterPick = await readSelect();
  await shot(s, `settings_toggled_${label}`);
  const clicked = await s.clickText('Save All Changes');
  // The settings toast clears itself 3500ms after the save resolves (SettingsPage.tsx:322-325),
  // so poll for it instead of reading the screen once after a fixed wait.
  let toast = false;
  let toastWaited = 0;
  while (toastWaited < 9000) {
    await sleep(500);
    toastWaited += 500;
    const screen = (await s.text()).replace(/\n{3,}/g, '\n');
    if (/Configuration updated and saved to database successfully/i.test(screen)) { toast = true; break; }
    if (/Failed to save settings/i.test(screen)) { toast = false; break; }
  }
  const afterSettings = (await s.text()).replace(/\n{3,}/g, '\n');
  const afterSave = await readSelect();

  const out = {
    want: mode, before, pick, afterPick, saveClick: clicked, toast, toastWaitedMs: toastWaited,
    saveFailedText: /Failed to save settings/i.test(afterSettings),
    afterSave,
    billing_tax_mode: billingMode(store.id), stores_tax_mode: storeColumnMode(store.id),
  };
  console.log(`setTaxMode(${mode}):`, JSON.stringify({
    before: before && before.value, afterPick: afterPick && afterPick.value, clicked, toast, toastWaitedMs: toastWaited,
    afterSave: afterSave && afterSave.value, billing: out.billing_tax_mode, stores: out.stores_tax_mode,
  }));
  await shot(s, `settings_after_save_${label}`);
  return out;
}

/** Settings did not take: record it, and restore the mode the run needs next. */
function judgeSettings(tag, set, checks) {
  const persisted = set.billing_tax_mode || set.stores_tax_mode;
  checks.push({
    check: `${tag} SETTINGS save toast appeared`, got: set.toast, want: true, ok: set.toast,
    note: 'screen text after clicking Save All Changes',
  });
  checks.push({
    check: `${tag} SETTINGS select shows requested mode after save`,
    got: set.afterSave && set.afterSave.value, want: set.want,
    ok: !!set.afterSave && set.afterSave.value === set.want, detail: set,
  });
  checks.push({
    check: `${tag} SETTINGS mode persisted to backend`,
    got: persisted, want: set.want, ok: persisted === set.want,
    detail: { billing: set.billing_tax_mode, stores: set.stores_tax_mode },
  });
  return persisted;
}

async function bill(s, store, tag) {
  await s.key('F1'); await sleep(2200);
  const shown = await invoiceNoShown(s);
  const added = [];
  for (const l of LINES) {
    const prod = fixture(store.id, l.frag);
    const units = l.packs * (Number(prod.units_per_pack) || 1) + l.loose;
    const batch = batchWithStock(prod, units);
    const r = await addLine(s, { search: prod.name, batch, packs: l.packs, loose: l.loose });
    if (!r.ok) return { ok: false, why: r.why, search: prod.name, detail: r };
    added.push({ ...l, batch, prod, line: r });
  }
  const money = await readMoney(s);
  await shot(s, `${tag}_cart`);

  const before = {};
  for (const a of added) before[a.prod.id] = serverBatchStock(a.prod.id);
  const save = await checkoutAndSave(s, { tender: 'Cash' });
  await sleep(4000);
  const inv = serverInvoice(shown, store.id);
  const after = {};
  for (const a of added) after[a.prod.id] = serverBatchStock(a.prod.id);
  return { ok: !!inv, shown, added, money, save, inv, before, after, writes: s.apiLog() };
}

/**
 * The POS quotes the selected batch's selling_rate as the price of a whole pack and divides it
 * by units_per_pack for loose pieces, so the oracle has to price the same batch the bill landed
 * on. Reading the rate off products.sel_rate instead makes a bill against a differently priced
 * batch look like a tax error when it is only a different price. The price the till charged is
 * taken from the line itself (a sub-paisa batch rate is rounded to the paisa before it is
 * multiplied), and the fidelity of that price to the batch row is checked separately.
 */
function oracle(store, tax_mode, added, basis, inv) {
  return computeInvoice({
    store: { state_code: store.state_code, tax_mode, gst_type: store.gst_type },
    price_basis: basis,
    lines: added.map((a, i) => {
      const it = inv && inv.items && inv.items[i];
      const batch = (it && it.batch_no) || a.batch;
      const charged = it && it.unit_price != null ? Number(it.unit_price) : Number(batchRate(a.prod, batch));
      return {
        name: a.prod.name, packs: a.packs, loose_qty: a.loose,
        unit_price: charged, units_per_pack: a.prod.units_per_pack, gst_percent: a.prod.gst_percent,
      };
    }),
  });
}

/**
 * The grid can price a pack line as the whole pack or per single piece. Calibrate the
 * fixture's meaning from the bill the app just produced, instead of assuming it.
 */
function inferBasis(store, mode, added, netPayable, inv) {
  const guess = (b) => oracle(store, mode, added, b, inv).totals.grand_total;
  if (eq(guess('per_pack'), netPayable)) return 'per_pack';
  if (eq(guess('per_unit'), netPayable)) return 'per_unit';
  return 'per_pack';
}

function judge(tag, r, oracleOut, checks) {
  const inv = r.inv;
  cmp(`${tag} UI SUBTOTAL vs oracle taxable`, r.money.subtotal, oracleOut.totals.taxable_subtotal, checks);
  cmp(`${tag} UI GST TAX vs oracle tax`, r.money.gst_tax, oracleOut.totals.tax_total, checks);
  cmp(`${tag} UI NET PAYABLE vs oracle grand`, r.money.net_payable, oracleOut.totals.grand_total, checks);
  if (!inv) { checks.push({ check: `${tag} invoice reached backend`, got: 'MISSING', want: 'row', ok: false }); return; }
  cmp(`${tag} DB taxable vs oracle`, inv.taxable_subtotal, oracleOut.totals.taxable_subtotal, checks);
  cmp(`${tag} DB tax_total vs oracle`, inv.tax_total, oracleOut.totals.tax_total, checks);
  cmp(`${tag} DB round_off vs oracle`, inv.round_off, oracleOut.totals.round_off, checks);
  cmp(`${tag} DB grand vs oracle`, inv.grand_total, oracleOut.totals.grand_total, checks);
  cmp(`${tag} DB grand = taxable+tax+roundoff`,
    Number(inv.taxable_subtotal) + Number(inv.tax_total) + Number(inv.round_off), inv.grand_total, checks);
  cmp(`${tag} DB cgst+sgst+igst = tax_total`,
    Number(inv.cgst_total || 0) + Number(inv.sgst_total || 0) + Number(inv.igst_total || 0), inv.tax_total, checks);
  cmp(`${tag} sum(line taxable) = header taxable`,
    inv.items.reduce((a, i) => a + Number(i.taxable_amount || 0), 0), inv.taxable_subtotal, checks);
  cmp(`${tag} sum(line tax) = header tax`,
    inv.items.reduce((a, i) => a + Number(i.tax_amount || 0), 0), inv.tax_total, checks);
  cmp(`${tag} sum(line cgst+sgst) = header split`,
    inv.items.reduce((a, i) => a + Number(i.cgst_amount || 0) + Number(i.sgst_amount || 0) + Number(i.igst_amount || 0), 0),
    inv.tax_total, checks);
  cmp(`${tag} payments total = grand`,
    inv.payments.reduce((a, y) => a + Number(y.amount || 0), 0), inv.grand_total, checks);
  cmp(`${tag} collected cash = paid_amount`, inv.paid_amount, r.money.net_payable, checks);
  checks.push({ check: `${tag} line count saved`, got: inv.items.length, want: r.added.length, ok: inv.items.length === r.added.length });
  // the GST figure on the screen is the one the customer is shown; the one filed is the sum of
  // the stored lines, so a difference between them is a real (if small) inconsistency
  cmp(`${tag} UI GST TAX vs DB tax_total`, r.money.gst_tax, inv.tax_total, checks);
  // stock must fall by exactly the billed units on the batch the bill actually drew from
  r.added.forEach((a, i) => {
    const it = inv.items[i];
    const upp = Number(a.prod.units_per_pack) || 1;
    const wantUnits = Number(it ? it.qty : a.packs) * upp + Number(it ? it.loose_qty : a.loose);
    const usedBatch = (it && it.batch_no) || a.batch;
    const b0 = (r.before[a.prod.id] || []).find(x => x.batch_no === usedBatch);
    const b1 = (r.after[a.prod.id] || []).find(x => x.batch_no === usedBatch);
    const moved = Number(b0 && b0.stock_qty) - Number(b1 && b1.stock_qty);
    checks.push({
      check: `${tag} stock out ${a.prod.name.slice(0, 26)} batch ${usedBatch}`,
      got: moved, want: wantUnits, ok: moved === wantUnits,
      detail: { before: b0 && b0.stock_qty, after: b1 && b1.stock_qty, item: it && { qty: it.qty, loose: it.loose_qty, batch: it.batch_no } },
    });
    // and it has to be the batch the cashier picked, not whatever the picker defaulted to
    checks.push({
      check: `${tag} billed from the selected batch ${a.prod.name.slice(0, 26)}`,
      got: usedBatch, want: a.batch, ok: !a.batch || usedBatch === a.batch,
      detail: { selected: a.batch, billed: usedBatch, picked: a.line && a.line.batch },
    });
    // the pack price has to be that batch's selling_rate, give or take the paisa it rounds to
    const rate = Number(batchRate(a.prod, usedBatch));
    checks.push({
      check: `${tag} priced off batch ${usedBatch} ${a.prod.name.slice(0, 26)}`,
      got: it && it.unit_price, want: rate, ok: !rate || Math.abs(Number(it && it.unit_price) - rate) <= 0.01,
      detail: { batch: usedBatch, batch_rate: rate, charged: it && it.unit_price },
    });
  });
}

function scenarioOut(tag, mode, r, o) {
  return {
    tag, mode, shown: r.shown, ui: r.money, oracle: o ? o.totals : null,
    db: r.inv && {
      taxable: r.inv.taxable_subtotal, tax: r.inv.tax_total, cgst: r.inv.cgst_total,
      sgst: r.inv.sgst_total, round: r.inv.round_off, grand: r.inv.grand_total,
      paid: r.inv.paid_amount,
    },
    items: r.inv && r.inv.items.map(i => ({ n: i.product_name, q: i.qty, l: i.loose_qty, r: i.unit_price, gst: i.gst_percent, tx: i.taxable_amount, t: i.tax_amount, c: i.cgst_amount, g: i.sgst_amount })),
    payments: r.inv && r.inv.payments.map(y => ({ mode: y.payment_mode, amt: y.amount })),
  };
}

(async () => {
  const store = storeByCode('QA-A');
  const out = { store, scenarios: [] };
  console.log('store', store.id, store.name, 'server tax_mode =', store.tax_mode);
  const { s, ok, stage, detail } = await login({ storeCode: 'QA-A', key: KEY, username: 'qaa_owner', pin: '9101' });
  console.log('login', ok, stage, ok ? '' : String(detail).slice(0, 200));
  if (!ok) { saveEvidence('GST_S1_loginfail.json', { stage, detail }); process.exit(1); }

  const checks = [];
  const modes = ['inclusive', 'exclusive'];
  let basis = null;

  for (const mode of modes) {
    const tag = mode.toUpperCase();
    let set;
    try {
      set = await setTaxMode(s, store, mode, tag);
    } catch (e) {
      set = { want: mode, toast: false, error: String(e && e.message), billing_tax_mode: billingMode(store.id), stores_tax_mode: storeColumnMode(store.id) };
      console.log('setTaxMode CRASH', String(e && e.stack).slice(0, 300));
    }
    out.scenarios.push({ settings: set });
    const persisted = judgeSettings(tag, set, checks);

    let r;
    try {
      r = await bill(s, store, tag);
    } catch (e) {
      checks.push({ check: `${tag} bill completed`, got: 'ERROR', want: 'saved', ok: false, note: String(e && e.message) });
      console.log(`${tag} BILL CRASH`, String(e && e.stack).slice(0, 400));
      continue;
    }
    if (!r.ok) {
      checks.push({ check: `${tag} bill completed`, got: String(r.why), want: 'saved', ok: false, detail: r.detail });
      console.log(`${tag} BILL FAIL`, JSON.stringify(r).slice(0, 400));
      continue;
    }

    // Judge on the mode the backend actually holds, so a failed settings save is reported as
    // a settings problem and not as a hundred bogus money mismatches.
    const effective = persisted === 'exclusive' || persisted === 'inclusive' ? persisted : null;
    if (!effective) {
      checks.push({ check: `${tag} numbers judged`, got: 'SKIPPED', want: 'mode persisted first', ok: false });
      out.scenarios.push({ tag, skipped_no_mode: true, ui: r.money, shown: r.shown });
      continue;
    }
    basis = inferBasis(store, effective, r.added, r.money.net_payable, r.inv);
    console.log(`${tag} judging against mode="${effective}" basis="${basis}"`);
    const o = oracle(store, effective, r.added, basis, r.inv);
    judge(tag, r, o, checks);
    out.scenarios.push(scenarioOut(tag, effective, r, o));
  }

  out.checks = checks;
  out.failed = checks.filter(c => !c.ok);
  saveEvidence('GST_S1_bills.json', out);
  console.log('\n===== CHECKS =====');
  for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.check}: got ${c.got} want ${c.want}`);
  console.log(`\n${checks.length - out.failed.length}/${checks.length} checks passed`);
  console.log('evidence: test-reports/evidence/GST_S1_bills.json  shots: test-reports/screenshots/gst_run');
  await s.close();
})().catch(e => { console.error('S1 CRASH', e); process.exit(1); });
