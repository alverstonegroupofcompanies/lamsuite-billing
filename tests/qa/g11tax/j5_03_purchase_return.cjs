// J5.03 purchase return via the till's sync path: blocked when the stock was sold; valid partial return reverses stock/payable/ITC
const { api, sql, evidence, state } = require('./lib.cjs');
(async () => {
  const st = state(); const ev = {};
  const C = { device: st.apiTillPH.token, token: st.apiTillPH.token };
  const mk = (no, batch, packs, rate) => {
    const taxable = packs * rate; const tax = Math.round(taxable * 12) / 100;
    return { items: [{ id: `sync_qa_${no}`, entity_type: 'purchase', action: 'create', payload: {
      id: `pr_${no}`, external_id: `pr_${no}`, purchase_number: no, module_key: 'purchase_return', supplier_id: '8', supplier_name: 'QA Pharma Distributors', supplier_gstin: '32AAACQ1234A1Z1',
      supplier_invoice_no: no, original_purchase_number: 'QA-PB-002', purchase_date: '2026-11-21', place_of_supply: '32', is_interstate: 0, itc_eligibility: 'eligible',
      subtotal: taxable, tax_total: tax, cgst_total: tax / 2, sgst_total: tax / 2, igst_total: 0, round_off: 0, grand_total: taxable + tax, status: 'returned',
      items: [{ id: `pri_${no}`, product_id: '5', product_name: 'QA Paracet 500 Strip', hsn_code: '30049099', batch_no: batch, expiry_date: batch === 'PA-OLD' ? '2027-03-31' : '2028-01-31', pack_qty: packs, loose_qty: 0, units_per_pack: 15, total_units: packs * 15, purchase_rate: rate, ptr: rate, gst_percent: 12, taxable_amount: taxable, cgst_amount: tax / 2, sgst_amount: tax / 2, igst_amount: 0, tax_amount: tax, total_amount: taxable + tax }],
    } }] };
  };
  const snap = () => ({ old: sql("select stock_qty from product_batches where batch_no='PA-OLD'")[0].stock_qty, new: sql("select stock_qty from product_batches where batch_no='PA-NEW' and store_id=4")[0].stock_qty, supplier: sql('select current_balance from parties where id=8')[0].current_balance, returns: sql("select count(*) n from purchases where module_key='purchase_return'")[0].n });
  // 1) more than on hand: 50 strips of PA-OLD (750 tablets) when only ~405 remain
  let b = snap();
  let r = await api('POST', '/sync/push/batch', mk('C02-PR-QA1', 'PA-OLD', 50, 50), C);
  ev.over = { st: r.status, body: r.text.slice(0, 400), before: b, after: snap() };
  console.log('OVER', r.status, r.text.slice(0, 250), JSON.stringify(ev.over.before), '->', JSON.stringify(ev.over.after));
  // 2) valid: 5 strips PA-NEW (75 tablets) @60 -> 300 + 36 = 336
  b = snap();
  r = await api('POST', '/sync/push/batch', mk('C02-PR-QA2', 'PA-NEW', 5, 60), C);
  ev.valid = { st: r.status, body: r.text.slice(0, 400), before: b, after: snap(), row: sql("select id,invoice_number,module_key,subtotal,tax_total,grand_total,status from purchases where invoice_number='C02-PR-QA2'"), ledger: sql("select event_type,qty_delta,reference_type from stock_ledger_entries where reference_type like '%PURCHASE%' and qty_delta<0") };
  console.log('VALID', r.status, r.text.slice(0, 200), JSON.stringify(ev.valid.before), '->', JSON.stringify(ev.valid.after), JSON.stringify(ev.valid.row), JSON.stringify(ev.valid.ledger));
  // 3) replay the valid return (retry) -> must not double
  b = snap();
  r = await api('POST', '/sync/push/batch', mk('C02-PR-QA2', 'PA-NEW', 5, 60), C);
  ev.replay = { st: r.status, before: b, after: snap() };
  console.log('REPLAY', r.status, JSON.stringify(b), '->', JSON.stringify(ev.replay.after));
  evidence('J5_03_purchase_return', ev);
})();
