// Re-run selected failures to confirm (second, independent execution)
const { api, sql, evidence, state, adminToken } = require('./lib.cjs');
(async () => {
  const st = state(); const t = await adminToken();
  const C = { device: st.apiTillPH.token, token: st.apiTillPH.token };
  const out = {};
  const base = (n, over) => Object.assign({ store_id: '4', external_id: `qa_re_${n}_${Date.now()}`, invoice_number: `C02-INV-RE${n}`, invoice_date: '2026-11-21', customer_name: 'Walk-in Customer', place_of_supply: '32', payment_mode: 'Cash', counter_code: 'C02', tax_mode: 'inclusive' }, over);
  // TAX-01 discount double-apply (10%: expect 81.00)
  let r = await api('POST', '/invoices', base(1, { paid_amount: 81, payments: [{ mode: 'Cash', amount: 81 }], grand_total: 81, items: [{ product_id: '5', product_name: 'QA Paracet 500 Strip', batch_id: '11', batch_no: 'PA-NEW', qty: 1, loose_qty: 0, units_per_pack: 15, unit_price: 90, mrp: 90, gst_percent: 12, discount_percent: 10, discount_amount: 9 }] }), C);
  out['TAX-01'] = sql(`select grand_total,discount_total,tax_total from invoices where invoice_number='C02-INV-RE1'`)[0];
  // SEC-04 cross-store product
  const lipBefore = sql('select stock_qty from product_batches where id=10')[0].stock_qty;
  r = await api('POST', '/invoices', base(2, { paid_amount: 90, payments: [{ mode: 'Cash', amount: 90 }], grand_total: 90, items: [{ product_id: '9', product_name: 'QA Ruby Lipstick', batch_id: '10', batch_no: 'LP-01', qty: 1, loose_qty: 0, units_per_pack: 1, unit_price: 90, mrp: 450, gst_percent: 12 }] }), C);
  out['SEC-04'] = { st: r.status, lip: [lipBefore, sql('select stock_qty from product_batches where id=10')[0].stock_qty] };
  // PAY-03 walk-in short payment
  r = await api('POST', '/invoices', base(3, { paid_amount: 10, payments: [{ mode: 'Cash', amount: 10 }], grand_total: 90, items: [{ product_id: '5', product_name: 'QA Paracet 500 Strip', batch_id: '11', batch_no: 'PA-NEW', qty: 1, loose_qty: 0, units_per_pack: 15, unit_price: 90, mrp: 90, gst_percent: 12 }] }), C);
  out['PAY-03'] = r.status;
  // SEC-01 anonymous create + cancel
  r = await api('POST', '/invoices', base(4, { paid_amount: 115, payments: [{ mode: 'Cash', amount: 115 }], grand_total: 115, items: [{ product_id: '6', product_name: 'QA Cough Syrup 100ml', batch_id: '7', batch_no: 'CS-A1', qty: 1, loose_qty: 0, units_per_pack: 1, unit_price: 115, mrp: 120, gst_percent: 12 }] }));
  const anonId = r.json && r.json.invoice && r.json.invoice.id;
  const c = anonId ? await api('POST', `/invoices/${anonId}/cancel`, { reason: 'anon' }) : null;
  out['SEC-01'] = { create: r.status, cancel: c && c.status };
  // PUR-06 duplicate supplier bill
  const pb = { supplier_id: 8, supplier_name: 'QA Pharma Distributors', invoice_number: 'QA-PB-DUP', invoice_date: '2026-11-21', place_of_supply: '32', lines: [{ product_id: 6, product_name: 'QA Cough Syrup 100ml', batch_no: 'CS-DUP', expiry_date: '2027-12-31', pack_qty: 1, units_per_pack: 1, purchase_rate: 10, mrp: 120, gst_percent: 12 }] };
  const d1 = await api('POST', '/purchases', pb, C); const d2 = await api('POST', '/purchases', pb, C);
  out['PUR-06'] = [d1.status, d2.status, sql("select count(*) n from purchases where invoice_number='QA-PB-DUP'")[0].n];
  out['PUR-05'] = sql("select count(*) n from product_batches where batch_no='CS-DUP'")[0].n;
  // SHF-01 shift open
  const so = await api('POST', '/counter/shift/open', { pin: '739214', opening_float: 500 }, C);
  out['SHF-01'] = so.status;
  // SEC-02 anonymous settings read of store 5
  out['SEC-02'] = (await api('GET', '/settings?store_id=5')).status;
  // ADJ-01 adjustments beyond daily document limit (policy 3/day)
  const a = await api('POST', '/stock/adjustments', { store_id: 4, mode: 'adjustment', reason: 'Damage', notes: 'reconfirm', lines: [{ product_id: 5, batch_id: 11, batch_no: 'PA-NEW', adjustment_qty: -1, unit_cost: 4 }] }, C);
  out['ADJ-01'] = a.status;
  console.log(JSON.stringify(out));
  evidence('reconfirm', out);
})();
