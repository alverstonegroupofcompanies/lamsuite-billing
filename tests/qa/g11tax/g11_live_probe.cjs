// G11-TAX live verification on the throwaway environment: real till API calls, real DB rows.
// Covers TAX-01 (double discount), TAX-02 (MRP ceiling), TAX-03 (place of supply), RET-01 (inclusive return).
const { api, sql, evidence, state } = require('./lib.cjs');

const st = state();
const PH = { device: st.apiTillPH.token, token: st.apiTillPH.token, store: 4 };
const CS = { device: st.apiTillCS.token, token: st.apiTillCS.token, store: 5 };
const ext = (tag) => `g11_${tag}_${Date.now()}`;
const out = { checks: [] };
const last = (q) => sql(q)[0];

function check(name, pass, detail) {
  out.checks.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail).slice(0, 300)}`);
}

const line = (over = {}) => Object.assign({
  product_id: '5', product_name: 'QA Paracet 500 Strip', batch_no: 'PA-NEW', expiry_date: '2028-01-31',
  qty: 1, loose_qty: 0, free_qty: 0, units_per_pack: 15, unit_price: 90, mrp: 90,
  discount_percent: 0, discount_amount: 0, gst_percent: 12, rate_basis: 'sel_rate',
}, over);

const bill = (over = {}) => Object.assign({
  external_id: ext('inv'), idempotency_key: ext('inv'), invoice_date: '2026-11-22',
  customer_name: 'Walk-in Customer', payment_mode: 'Cash', counter_code: 'C02',
  items: [line()],
}, over);

const head = () => last('select invoice_number,customer_name,place_of_supply,subtotal,taxable_subtotal,discount_total,cgst_total,sgst_total,igst_total,tax_total,grand_total from invoices where id=(select max(id) from invoices)');

(async () => {
  const paracet = last("select id from products where name='QA Paracet 500 Strip'").id;
  const faceCream = last("select id from products where name='QA Glow Face Cream 50g'").id;

  // --- TAX-03: the buyer's GSTIN decides inter-state, a name never does --------------
  const withGstin = await api('POST', '/invoices', bill({
    customer_name: 'Bengaluru Boutique', customer_phone: '9880000111', customer_gstin: '29ABCDE5678F1Z9',
    place_of_supply: '29', items: [line({ qty: 2 })],
  }), PH);
  const interHead = head();
  check('TAX-03 a Karnataka GSTIN buyer bills IGST',
    withGstin.status === 201 && interHead.igst_total > 0 && interHead.cgst_total === 0, { st: withGstin.status, ...interHead });

  const walkIn = await api('POST', '/invoices', bill({ items: [line({ qty: 2 })] }), PH);
  const walkHead = head();
  check('TAX-03 a walk-in follows its own store (Kerala => CGST+SGST, no IGST)',
    walkIn.status === 201 && walkHead.igst_total === 0 && walkHead.place_of_supply.startsWith('32')
    && Math.abs(walkHead.cgst_total + walkHead.sgst_total - walkHead.tax_total) < 0.01, { st: walkIn.status, ...walkHead });

  const csBill = await api('POST', '/invoices', {
    external_id: ext('cs'), idempotency_key: ext('cs'), invoice_date: '2026-11-22', customer_name: 'Walk-in Customer',
    payment_mode: 'Cash', counter_code: 'C02',
    items: [{ product_id: String(faceCream), product_name: 'QA Glow Face Cream 50g', batch_no: 'GC-01', expiry_date: '2028-01-31',
      qty: 1, loose_qty: 0, units_per_pack: 1, unit_price: 250, mrp: 295, gst_percent: 18, rate_basis: 'sel_rate',
      discount_percent: 0, discount_amount: 0 }],
  }, CS);
  const csHead = head();
  check('TAX-03 the cosmetics store (KA 29) walk-in bills its own state, exclusive tax',
    csBill.status === 201 && csHead.igst_total === 0 && csHead.place_of_supply.startsWith('29')
    && csHead.taxable_subtotal === 250 && Math.abs(csHead.tax_total - 45) < 0.01, { st: csBill.status, ...csHead });

  // --- TAX-01: a percent plus the amount it produced discounts once -------------------
  const echo = await api('POST', '/invoices', bill({ items: [line({ discount_percent: 10, discount_amount: 9 })] }), PH);
  const echoHead = head();
  const echoLine = last('select discount_percent,discount_amount,taxable_amount,tax_amount,total_amount from invoice_items where invoice_id=(select max(id) from invoices)');
  check('TAX-01 the echo of a percent does not discount the line twice',
    echo.status === 201 && echoHead.discount_total === 9 && echoHead.taxable_subtotal === 72.32 && echoHead.grand_total === 81,
    { st: echo.status, head: echoHead, line: echoLine });

  // --- TAX-01b: a trade percent *and* a separate scheme amount both come off ----------
  const two = await api('POST', '/invoices', bill({ items: [line({ qty: 10, discount_percent: 10, discount_amount: 20 })] }), PH);
  const twoHead = head();
  check('TAX-01b a real second discount is not swallowed',
    two.status === 201 && twoHead.discount_total === 110 && twoHead.grand_total === 790,
    { st: two.status, body: two.status === 201 ? undefined : (two.text || '').slice(0, 180), ...twoHead });

  // --- TAX-02: billing above MRP is refused at the counter ---------------------------
  const over = await api('POST', '/invoices', bill({ items: [line({ unit_price: 150 })] }), PH);
  check('TAX-02 a rate above MRP is refused with MRP_EXCEEDED',
    over.status === 422 && /MRP_EXCEEDED/.test(over.text || ''), { st: over.status, body: (over.text || '').slice(0, 150) });

  // --- TAX-02: an offline bill over MRP is booked, flagged, not rejected -------------
  const syncBody = {
    invoices: [Object.assign(bill({
      invoice_number: `C02-INV-MRPSYNC-${Date.now()}`,
      items: [Object.assign(line({ unit_price: 150 }), {
        taxable_amount: 133.93, cgst_amount: 8.04, sgst_amount: 8.03, igst_amount: 0, tax_amount: 16.07, total_amount: 150,
      })],
    }), {
      store_id: 4, counter_code: 'C02', subtotal: 133.93, taxable_subtotal: 133.93, discount_total: 0,
      tax_total: 16.07, cgst_total: 8.04, sgst_total: 8.03, igst_total: 0, cess_total: 0, round_off: 0,
      grand_total: 150, paid_amount: 150, status: 'issued', place_of_supply: '32',
    })],
  };
  const overSync = await api('POST', '/sync/push/invoices', syncBody, PH);
  const synced = last('select id,invoice_number,grand_total,taxable_subtotal,tax_total from invoices where id=(select max(id) from invoices)');
  const syncEvent = last(`select status, json_extract(client_data,'$.recalculation') recalc from sync_events where entity_type='invoice' and entity_id='${synced.id}'`);
  check('TAX-02 an offline bill over MRP is booked as sold and flagged for review',
    overSync.status === 200 && synced.grand_total === 150 && /MRP/.test(syncEvent.recalc || ''),
    { st: overSync.status, synced, recalc: syncEvent.recalc });

  // --- RET-01: returning part of an MRP-inclusive bill credits the charged share ------
  const incl = await api('POST', '/invoices', bill({ invoice_number: `C02-INV-INCL-${Date.now()}` }), PH);
  const inclHead = head();
  check('inclusive bill seeded (1 strip of 15 tabs at Rs 90 incl 12% = Rs 90.00)',
    incl.status === 201 && inclHead.grand_total === 90, { st: incl.status, ...inclHead });

  const ret = await api('POST', '/returns/sales', {
    original_invoice_number: inclHead.invoice_number, refund_mode: 'Cash',
    items: [{ product_id: String(paracet), product_name: 'QA Paracet 500 Strip', batch_no: 'PA-NEW',
      qty: 0, loose_qty: 5, units_per_pack: 15, reason: 'customer_return' }],
  }, PH);
  const note = last("select invoice_number,module_key,status,subtotal,taxable_subtotal,discount_total,tax_total,cgst_total,sgst_total,round_off,grand_total from invoices where module_key='credit_note' order by id desc limit 1");
  const noteLine = note ? last(`select qty,loose_qty,unit_price,taxable_amount,tax_amount,total_amount from invoice_items where invoice_id=(select id from invoices where invoice_number='${note.invoice_number}')`) : null;
  check('RET-01 five of fifteen Rs 90.00-inclusive tablets credit Rs 30.00, not Rs 33.60',
    ret.status === 201 && note && Math.abs(note.grand_total - 30) < 0.01 && Math.abs(note.tax_total - 3.21) < 0.01 && note.round_off === 0,
    { st: ret.status, body: ret.status === 201 ? undefined : (ret.text || '').slice(0, 180), note, line: noteLine });

  evidence('G11_live_probe', out);
  const failed = out.checks.filter((c) => !c.pass);
  console.log(`\n${out.checks.length - failed.length}/${out.checks.length} G11 live checks passed`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
})();
