// J3.02/J3.04 server purchase engine as a claimed counter (till path blocked by PUR-01):
// 10,000 @12% + freight 200 @18% add-to-cost + packing 100 @18% expense = 11,554; landed cost; expense; duplicate bill no
const { api, sql, evidence, state, saveState } = require('./lib.cjs');
const { issueCode } = require('./pos.cjs');
(async () => {
  const st = state(); const ev = {};
  // an API "till" on PH Back Till (counter 3)
  const code = await issueCode(3, 4);
  const c = await api('POST', '/counters/claim', { code, device_uuid: 'qa-api-till-ph-c02', device_name: 'QA API till' });
  const tok = c.json && c.json.device_token; ev.claim = { st: c.status, keys: Object.keys(c.json || {}) };
  st.apiTillPH = { counterId: 3, token: tok }; saveState(st);
  const H = { device: tok, token: tok };
  const body = (bill) => ({
    supplier_id: 8, supplier_name: 'QA Pharma Distributors', supplier_gstin: '32AAACQ1234A1Z1', invoice_number: bill, invoice_date: '2026-11-21', place_of_supply: '32',
    lines: [
      { product_id: 5, product_name: 'QA Paracet 500 Strip', hsn_code: '30049099', batch_no: 'PA-CHG', expiry_date: '2028-06-30', pack_qty: 100, loose_qty: 0, free_qty: 0, units_per_pack: 15, purchase_rate: 60, mrp: 90, selling_rate: 90, gst_percent: 12 },
      { product_id: 5, product_name: 'QA Paracet 500 Strip', hsn_code: '30049099', batch_no: 'PA-CHG2', expiry_date: '2028-06-30', pack_qty: 50, loose_qty: 0, free_qty: 0, units_per_pack: 15, purchase_rate: 50, mrp: 90, selling_rate: 90, gst_percent: 12 },
      { product_id: 6, product_name: 'QA Cough Syrup 100ml', hsn_code: '30049011', batch_no: 'CS-CHG', expiry_date: '2027-12-31', pack_qty: 25, loose_qty: 0, free_qty: 0, units_per_pack: 1, purchase_rate: 60, mrp: 120, selling_rate: 115, gst_percent: 12 },
    ],
    charges: [
      { head_code: 'FREIGHT', amount: 200, gst_percent: 18, treatment: 'add_to_cost', spread_method: 'value', itc_eligibility: 'eligible', place_of_supply: '32' },
      { head_code: 'PACKING', amount: 100, gst_percent: 18, treatment: 'expense', spread_method: 'value', itc_eligibility: 'eligible', place_of_supply: '32' },
    ],
  });
  const before = { supplier: sql('select current_balance from parties where id=8')[0], expenses: sql('select count(*) n from expenses where store_id=4')[0].n };
  const r = await api('POST', '/purchases', body('QA-PB-003'), H);
  ev.post = { st: r.status, body: r.text.slice(0, 2500) };
  console.log('POST', r.status, r.text.slice(0, 300));
  const p = sql("select id,invoice_number,subtotal,tax_total,cgst_total,sgst_total,grand_total,paid_amount,status from purchases where invoice_number='QA-PB-003'");
  ev.db = {
    purchase: p,
    items: p.length ? sql(`select batch_no,qty,purchase_rate,taxable_amount,tax_amount,total_amount,landed_unit_cost,charge_allocation from purchase_items where purchase_id=${p[0].id}`) : [],
    charges: p.length ? sql(`select * from purchase_charges where purchase_id=${p[0].id}`) : [],
    allocations: p.length ? sql(`select * from purchase_charge_allocations where purchase_charge_id in (select id from purchase_charges where purchase_id=${p[0].id})`) : [],
    batches: sql("select batch_no,stock_qty,purchase_rate,landed_cost_rate from product_batches where batch_no in ('PA-CHG','PA-CHG2','CS-CHG')"),
    expenses: sql('select * from expenses where store_id=4'),
    supplier_balance: sql('select current_balance from parties where id=8')[0],
    ledger: sql("select batch_id,qty_delta,event_type,reference_id from stock_ledger_entries where batch_id in (select id from product_batches where batch_no in ('PA-CHG','PA-CHG2','CS-CHG'))"),
  };
  console.log(JSON.stringify(ev.db, null, 0).slice(0, 3000));
  // J3.04 duplicate supplier bill number (same supplier) via API and later via till
  const dup = await api('POST', '/purchases', body('QA-PB-003'), H);
  ev.duplicate = { st: dup.status, body: dup.text.slice(0, 400), count: sql("select count(*) n from purchases where invoice_number='QA-PB-003' and store_id=4")[0].n };
  console.log('DUP', dup.status, dup.text.slice(0, 200), 'count', ev.duplicate.count);
  ev.before = before;
  evidence('J3_02_engine_api', ev);
})();
