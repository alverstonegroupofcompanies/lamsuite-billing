// J9 compare dashboard / daily summary / sales register / GST views with an independent calculation from the documents
const { api, sql, evidence, state, adminToken, P, R } = require('./lib.cjs');
const D = '2026-11-21';
(async () => {
  const st = state(); const ev = {};
  const t = await adminToken(); const A = { token: t, store: 4 };
  const C = { device: st.apiTillPH.token, token: st.apiTillPH.token };
  // ---- independent oracle from document lines (paise, BigInt) for QA-PH today
  const inv = sql(`select id,invoice_number,module_key,status,grand_total from invoices where store_id=4 and invoice_date='${D}'`);
  const lines = sql(`select ii.invoice_id,ii.gst_percent,ii.taxable_amount,ii.cgst_amount,ii.sgst_amount,ii.igst_amount,ii.total_amount from invoice_items ii join invoices i on i.id=ii.invoice_id where i.store_id=4 and i.invoice_date='${D}'`);
  const pays = sql(`select p.invoice_id,p.payment_mode,p.amount,p.status from invoice_payments p join invoices i on i.id=p.invoice_id where i.store_id=4 and i.invoice_date='${D}'`);
  const byId = Object.fromEntries(inv.map((i) => [i.id, i]));
  const o = { sales_count: 0n, gross: 0n, taxable: 0n, tax: 0n, cgst: 0n, sgst: 0n, igst: 0n, returns: 0n, cancelled: 0, slab: {}, tender: {} };
  for (const i of inv) {
    if (i.status === 'cancelled') { o.cancelled++; continue; }
    if (i.module_key === 'invoice') { o.sales_count++; o.gross += P(i.grand_total); } else if (['credit_note', 'sales_return'].includes(i.module_key)) o.returns += P(i.grand_total);
  }
  for (const l of lines) {
    const i = byId[l.invoice_id]; if (!i || i.status === 'cancelled' || !['invoice', 'credit_note', 'sales_return'].includes(i.module_key)) continue;
    const sign = i.module_key === 'invoice' ? 1n : -1n;
    o.taxable += sign * P(l.taxable_amount); o.cgst += sign * P(l.cgst_amount); o.sgst += sign * P(l.sgst_amount); o.igst += sign * P(l.igst_amount);
    const k = String(l.gst_percent); o.slab[k] = (o.slab[k] || 0n) + sign * P(l.taxable_amount);
  }
  o.tax = o.cgst + o.sgst + o.igst;
  // Tenders = money that stayed with the business: each document's rows are applied up to its
  // grand total (a 500 note on a 210 bill is 210, the 290 change is not takings); what is left
  // unpaid is Credit; returns subtract. Sum of tenders therefore equals net sales.
  const paysBy = {}; for (const p of pays) (paysBy[p.invoice_id] ||= []).push(p);
  const addT = (k, v) => { o.tender[k] = (o.tender[k] || 0n) + v; };
  for (const i of inv) {
    if (i.status === 'cancelled' || !['invoice', 'credit_note', 'sales_return'].includes(i.module_key)) continue;
    const sign = i.module_key === 'invoice' ? 1n : -1n;
    let left = P(i.grand_total) > 0n ? P(i.grand_total) : 0n;
    for (const p of paysBy[i.id] || []) {
      if (p.status === 'refunded' || p.status === 'bounced') continue;
      const amt = P(p.amount) < left ? P(p.amount) : left; left -= amt; addT(p.payment_mode, sign * amt);
    }
    if (left > 0n) addT('Credit', sign * left);
  }
  const oracle = { sales_count: Number(o.sales_count), cancelled_excluded: o.cancelled, gross_sales: R(o.gross), returns: R(o.returns), net_sales: R(o.gross - o.returns), taxable_net: R(o.taxable), tax_net: R(o.tax), cgst: R(o.cgst), sgst: R(o.sgst), igst: R(o.igst),
    taxable_by_slab: Object.fromEntries(Object.entries(o.slab).map(([k, v]) => [k, R(v)])), tenders: Object.fromEntries(Object.entries(o.tender).map(([k, v]) => [k, R(v)])) };
  ev.oracle = oracle; console.log('ORACLE', JSON.stringify(oracle));
  // header vs lines integrity for today's docs
  ev.header_vs_lines = sql(`select i.invoice_number,i.tax_total,round(sum(ii.tax_amount),2) line_tax,i.grand_total,round(sum(ii.total_amount),2) line_total,i.paid_amount from invoices i join invoice_items ii on ii.invoice_id=i.id where i.store_id=4 group by i.id having abs(i.tax_total-sum(ii.tax_amount))>0.005 or abs(i.grand_total-sum(ii.total_amount)-coalesce(i.round_off,0))>0.005`);
  // ---- product surfaces
  const get = async (label, url, H) => { const r = await api('GET', url, undefined, H); ev[label] = { st: r.status, body: r.json ?? r.text.slice(0, 1500) }; console.log(label, r.status, JSON.stringify(r.json ?? r.text).slice(0, 900)); };
  await get('till_daily_summary', `/reports/daily-summary?date=${D}&start_date=${D}&end_date=${D}`, C);
  await get('till_dashboard', `/dashboard/metrics?start_date=${D}&end_date=${D}&period=today`, C);
  await get('till_gstr1', `/reports/gstr-1?start_date=${D}&end_date=${D}`, C);
  await get('till_hsn', `/reports/hsn-summary?start_date=${D}&end_date=${D}`, C);
  await get('till_daily_collection', `/reports/daily-collection?date=${D}&start_date=${D}&end_date=${D}`, C);
  await get('admin_dashboard', `/admin/dashboard?store_id=4&start_date=${D}&end_date=${D}`, A);
  await get('admin_sales_register', `/admin/reports/sales-register?store_id=4&start_date=${D}&end_date=${D}`, A);
  await get('admin_gstr1', `/admin/reports/gstr1?store_id=4&start_date=${D}&end_date=${D}`, A);
  await get('admin_daily_summary', `/admin/reports/daily-summary?store_id=4&start_date=${D}&end_date=${D}&date=${D}`, A);
  await get('admin_invoices', `/admin/invoices?store_id=4&start_date=${D}&end_date=${D}&per_page=200`, A);
  evidence('J9_reports', ev);
})();
