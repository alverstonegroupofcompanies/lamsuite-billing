// J4.03-J4.05 server-side enforcement, replaying the till's own invoice payload shape as a claimed counter
const { api, sql, evidence, state } = require('./lib.cjs');
const st = state();
const H = { device: st.apiTillPH.token, token: st.apiTillPH.token };
let seq = 0;
const base = (over = {}) => {
  seq += 1;
  const ext = `qa_rule_${Date.now()}_${seq}`;
  return Object.assign({
    store_id: '4', store_code: 'QA-PH', external_id: ext, idempotency_key: ext, invoice_number: `C02-INV-QA${String(seq).padStart(3, '0')}`, invoice_date: '2026-11-21',
    customer_id: '', customer_name: 'Walk-in Customer', place_of_supply: '32-Kerala', payment_mode: 'Cash', paid_amount: 90,
    payments: [{ mode: 'Cash', amount: 90, status: 'received' }], counter_id: 'cntr_3', tax_mode: 'inclusive', store_state: '32', gst_type: 'regular', is_composition: false,
    subtotal: 80.36, discount_total: 0, tax_total: 9.64, round_off: 0, grand_total: 90, is_inter_state: false, counter_code: 'C02',
    items: [{ product_id: '5', product_name: 'QA Paracet 500 Strip', batch_id: '11', batch_no: 'PA-NEW', expiry_date: '2028-01-31', qty: 1, loose_qty: 0, free_qty: 0, free_loose_qty: 0, units_per_pack: 15, unit_price: 90, mrp: 90, discount_percent: 0, discount_amount: 0, gst_percent: 12, rate_basis: 'sel_rate' }],
  }, over);
};
const cases = [
  ['J4.03 split cash 50 + UPI 40 with ref', base({ payment_mode: 'Split', payments: [{ mode: 'Cash', amount: 50, status: 'received' }, { mode: 'UPI', amount: 40, reference_no: 'UPI-QA-0001', status: 'received' }] }), 'accept; 2 payment rows 50+40; ref kept'],
  ['J4.03 UPI without reference', base({ payment_mode: 'UPI', payments: [{ mode: 'UPI', amount: 90, status: 'received' }] }), 'refuse (reference required) or flag'],
  ['J4.03 cash short-paid (40 of 90) walk-in', base({ paid_amount: 40, payments: [{ mode: 'Cash', amount: 40, status: 'received' }] }), 'refuse: walk-in cannot leave a balance'],
  ['J4.04 credit for walk-in', base({ payment_mode: 'Credit', paid_amount: 0, payments: [{ mode: 'Credit', amount: 90, status: 'received' }] }), 'refuse'],
  ['J4.04 credit named customer within limit (500 of 1000)', base({ customer_id: '6', customer_name: 'QA Credit Customer', payment_mode: 'Credit', paid_amount: 0, payments: [{ mode: 'Credit', amount: 90, status: 'received' }] }), 'accept; customer balance +90'],
  ['J4.04 credit over limit (1080 > 1000)', base({ customer_id: '6', customer_name: 'QA Credit Customer', payment_mode: 'Credit', paid_amount: 0, subtotal: 964.29, tax_total: 115.71, grand_total: 1080, payments: [{ mode: 'Credit', amount: 1080, status: 'received' }], items: [{ product_id: '5', product_name: 'QA Paracet 500 Strip', batch_id: '11', batch_no: 'PA-NEW', expiry_date: '2028-01-31', qty: 12, loose_qty: 0, units_per_pack: 15, unit_price: 90, mrp: 90, gst_percent: 12, discount_percent: 0, discount_amount: 0 }] }), 'refuse: over credit limit'],
  ['J4.05 letters in quantity', base({ items: [{ product_id: '5', product_name: 'QA Paracet 500 Strip', batch_id: '11', batch_no: 'PA-NEW', qty: 'abc', loose_qty: 0, units_per_pack: 15, unit_price: 90, mrp: 90, gst_percent: 12 }] }), '422'],
  ['J4.05 negative quantity', base({ items: [{ product_id: '5', product_name: 'QA Paracet 500 Strip', batch_id: '11', batch_no: 'PA-NEW', qty: -3, loose_qty: 0, units_per_pack: 15, unit_price: 90, mrp: 90, gst_percent: 12 }] }), '422'],
  ['J4.05 loose-only quantity (7 tablets = 42.00)', base({ subtotal: 37.5, tax_total: 4.5, grand_total: 42, paid_amount: 42, payments: [{ mode: 'Cash', amount: 42, status: 'received' }], items: [{ product_id: '5', product_name: 'QA Paracet 500 Strip', batch_id: '11', batch_no: 'PA-NEW', expiry_date: '2028-01-31', qty: 0, loose_qty: 7, units_per_pack: 15, unit_price: 90, mrp: 90, gst_percent: 12, discount_percent: 0, discount_amount: 0 }] }), 'accept: 42.00 = 37.50 + 4.50; stock -7'],
  ['J4.05 out-of-stock product (Alprazolam, 0 on hand)', base({ subtotal: 26.79, tax_total: 3.21, grand_total: 30, paid_amount: 30, payments: [{ mode: 'Cash', amount: 30, status: 'received' }], items: [{ product_id: '7', product_name: 'QA Alprazolam 0.25 Strip', batch_id: '8', batch_no: 'B1', qty: 1, loose_qty: 0, units_per_pack: 10, unit_price: 30, mrp: 30, gst_percent: 12 }] }), 'refuse, or accept with negative-stock flag + review'],
  ['J4.05 discount 60% (no approval)', base({ subtotal: 32.14, discount_total: 54, tax_total: 3.86, grand_total: 36, paid_amount: 36, payments: [{ mode: 'Cash', amount: 36, status: 'received' }], items: [{ product_id: '5', product_name: 'QA Paracet 500 Strip', batch_id: '11', batch_no: 'PA-NEW', expiry_date: '2028-01-31', qty: 1, loose_qty: 0, units_per_pack: 15, unit_price: 90, mrp: 90, gst_percent: 12, discount_percent: 60, discount_amount: 54 }] }), 'refuse/require approval above the store limit'],
  ['J4.x client-understated totals (grand 1.00 for a 90.00 line)', base({ subtotal: 0.89, tax_total: 0.11, grand_total: 1, paid_amount: 1, payments: [{ mode: 'Cash', amount: 1, status: 'received' }] }), 'server recomputes to 90.00 or refuses'],
  ['J4.x price above MRP (unit 150, MRP 90)', base({ subtotal: 133.93, tax_total: 16.07, grand_total: 150, paid_amount: 150, payments: [{ mode: 'Cash', amount: 150, status: 'received' }], items: [{ product_id: '5', product_name: 'QA Paracet 500 Strip', batch_id: '11', batch_no: 'PA-NEW', qty: 1, loose_qty: 0, units_per_pack: 15, unit_price: 150, mrp: 90, gst_percent: 12 }] }), 'refuse (MRP capping)'],
  ['J4.x another store\'s product (QA-CS lipstick id 9) on a QA-PH bill', base({ items: [{ product_id: '9', product_name: 'QA Ruby Lipstick', batch_id: '10', batch_no: 'LP-01', qty: 1, loose_qty: 0, units_per_pack: 1, unit_price: 90, mrp: 450, gst_percent: 12 }] }), 'refuse cross-store reference'],
];
(async () => {
  const out = [];
  for (const [label, body, expect] of cases) {
    const before = { stock5: sql('select current_stock from products where id=5')[0].current_stock, cust6: sql('select current_balance from parties where id=6')[0].current_balance, lip: sql('select stock_qty from product_batches where id=10')[0].stock_qty };
    const r = await api('POST', '/invoices', body, H);
    const inv = r.json && (r.json.invoice || r.json.data);
    const id = inv && inv.id;
    const row = id ? sql(`select invoice_number,grand_total,paid_amount,payment_mode,payment_status,subtotal,tax_total,discount_total from invoices where id=${id}`)[0] : null;
    const pays = id ? sql(`select payment_mode,amount,reference_no from invoice_payments where invoice_id=${id}`) : [];
    const after = { stock5: sql('select current_stock from products where id=5')[0].current_stock, cust6: sql('select current_balance from parties where id=6')[0].current_balance, lip: sql('select stock_qty from product_batches where id=10')[0].stock_qty };
    out.push({ label, expect, status: r.status, message: (r.json && (r.json.message || r.json.error)) || null, row, pays, before, after });
    console.log(`${r.status} | ${label} | expect: ${expect} | ${row ? JSON.stringify(row) : (r.text || '').slice(0, 160)} ${pays.length ? '| pays ' + JSON.stringify(pays) : ''} | stock ${before.stock5}->${after.stock5} cust6 ${before.cust6}->${after.cust6} lip ${before.lip}->${after.lip}`);
  }
  evidence('J4_rules_api', out);
})();
