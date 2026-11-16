/**
 * Group K — reports, GST views and their tenant scoping.
 * Two jobs:
 *   1. cross-store reads through the POS report endpoints (does a store A token see store B?);
 *   2. reconcile the statutory views against raw SQL to the paisa.
 */
const { sql, sqlOne, saveEvidence, BACKEND } = require('./driver.cjs');
const manifest = require('./manifest.json');

const J = { 'Content-Type': 'application/json', Accept: 'application/json' };
const out = { probes: [], defects: [], reconciliation: [] };
const p2 = (v) => Number(v ?? 0).toFixed(2);

async function get(url, token) {
  const res = await fetch(`${BACKEND}${url}`, { headers: { ...J, Authorization: `Bearer ${token}` } });
  let body; const text = await res.text();
  try { body = JSON.parse(text); } catch { body = { _raw: text.slice(0, 300) }; }
  out.probes.push({ url, status: res.status, response: JSON.stringify(body).slice(0, 1400) });
  return { status: res.status, body };
}

(async () => {
  const A = manifest.stores['QA-A'], B = manifest.stores['QA-B'], C = manifest.stores['QA-C'], E = manifest.stores['QA-E'];
  const login = await fetch(`${BACKEND}/api/staff/login`, { method: 'POST', headers: J, body: JSON.stringify({ store_id: A.id, user_id: A.users.cash.id, username: A.users.cash.username, pin: A.users.cash.pin }) }).then(r => r.json());
  const token = login.token || (login.data && login.data.token);
  if (!token) { console.error('staff login failed', JSON.stringify(login).slice(0, 300)); process.exit(1); }
  console.log('store A cashier token acquired; role:', login.role || (login.user && login.user.role));

  // ---------- K-ISO: can a store A cashier read another store's statutory reports? ----------
  const isoUrls = [
    `/api/reports/daily-summary?store_id=${B.id}&date=${new Date().toISOString().slice(0, 10)}`,
    `/api/reports/gstr-1?store_id=${B.id}`,
    `/api/reports/hsn-summary?store_id=${B.id}`,
    `/api/reports/cash-book?store_id=${B.id}`,
    `/api/reports/daily-collection?store_id=${B.id}`,
    `/api/reports/profit?store_id=${B.id}`,
    `/api/reports/stock-ledger?store_id=${B.id}`,
    `/api/reports/customer-aging?store_id=${B.id}`,
    `/api/reports/tax-reconciliation?store_id=${B.id}`,
    `/api/reports/top-selling?store_id=${B.id}`,
  ];
  const headerProbe = await get(`/api/reports/gstr-1`, token);
  out.probes[out.probes.length - 1].note = 'no store_id at all, X-Store-Id header variant tested separately below';
  const viaHeader = await fetch(`${BACKEND}/api/reports/gstr-1`, { headers: { ...J, Authorization: `Bearer ${token}`, 'X-Store-Id': String(B.id) } });
  out.probes.push({ url: 'X-Store-Id header variant /api/reports/gstr-1', status: viaHeader.status, response: (await viaHeader.text()).slice(0, 600) });

  const leaked = [];
  for (const u of isoUrls) {
    const r = await get(u, token);
    const askedStore = Number(u.match(/store_id=(\d+)/)[1]);
    if (r.status === 200) leaked.push({ url: u, status: r.status, body: JSON.stringify(r.body).slice(0, 220) });
  }
  if (leaked.length) {
    out.defects.push({ id: 'REPORT-ISO', severity: 'Critical', type: 'Security', module: 'Reports / tenant isolation',
      title: `A store A cashier token can read ${leaked.length} statutory reports of other stores by changing store_id`,
      actual: leaked, expected: '403 or forced scoping to the caller\'s own store',
      suspected: 'ReportController::resolveStoreId() trusts X-Store-Id / store_id with no ownership check and routes/api.php lines 169-178 lack the scope.store middleware' });
  }
  console.log(`\nK-ISO: ${leaked.length}/${isoUrls.length} foreign-store report reads succeeded`);

  // ---------- K-REC: reconcile today's numbers for store A ----------
  const today = new Date().toISOString().slice(0, 10);
  const raw = sql(`select
      sum(case when module_key='invoice' then grand_total else 0 end) gross,
      sum(case when module_key='credit_note' then grand_total else 0 end) returns,
      sum(case when status='cancelled' then grand_total else 0 end) cancelled,
      sum(taxable_subtotal) taxable, sum(tax_total) tax,
      sum(cgst_total) cgst, sum(sgst_total) sgst, sum(igst_total) igst,
      sum(round_off) round_off, count(*) c
    from invoices where store_id=${A.id} and date(invoice_date)='${today}'`)[0];
  const rateWise = sql(`select i.gst_percent, sum(i.taxable_amount) taxable, sum(i.tax_amount) tax,
      sum(i.cgst_amount) cgst, sum(i.sgst_amount) sgst, sum(i.igst_amount) igst
    from invoice_items i join invoices v on v.id=i.invoice_id
    where v.store_id=${A.id} and date(v.invoice_date)='${today}' and v.status!='cancelled'
    group by i.gst_percent order by i.gst_percent`);
  console.log('raw SQL for store A today:', JSON.stringify(raw));
  console.log('rate-wise line taxes:', JSON.stringify(rateWise));

  const ds = await get(`/api/reports/daily-summary?store_id=${A.id}&date=${today}`, token);
  const g1 = await get(`/api/reports/gstr-1?store_id=${A.id}`, token);
  const hsn = await get(`/api/reports/hsn-summary?store_id=${A.id}`, token);
  const taxrec = await get(`/api/reports/tax-reconciliation?store_id=${A.id}`, token);

  out.reconciliation.push({ store: 'QA-A', sql_row: raw, rate_wise: rateWise, daily_summary: ds.body, gstr1_keys: Object.keys(g1.body || {}), hsn_keys: Object.keys(hsn.body || {}) });

  // every invoice's tax_total must equal the sum of its line taxes, and the split must sum to it
  const badTax = sql(`select v.id, v.invoice_number, v.tax_total, sum(i.tax_amount) line_sum,
      v.cgst_total, v.sgst_total, v.igst_total, (v.cgst_total+v.sgst_total+v.igst_total) split_sum
    from invoices v join invoice_items i on i.invoice_id=v.id
    where v.store_id in (${A.id},${B.id},${C.id},${E.id}) and v.status!='cancelled'
    group by v.id having round(abs(v.tax_total - sum(i.tax_amount)),2) > 0.005
        or round(abs(v.tax_total - (v.cgst_total+v.sgst_total+v.igst_total)),2) > 0.005`);
  out.reconciliation.push({ check: 'invoice tax vs line taxes and CGST/SGST/IGST split', mismatches: badTax });
  if (badTax.length) {
    out.defects.push({ id: 'TAX-SPLIT-SUM', severity: 'Critical', type: 'Logic', module: 'Billing/GST',
      title: `${badTax.length} saved invoice(s) whose CGST+SGST+IGST do not add up to tax_total, or whose tax_total does not equal the sum of line taxes`,
      actual: badTax.slice(0, 12), expected: 'statutory columns must reconcile to the paisa',
      suspected: 'TaxEngine rounds CGST and SGST independently instead of deriving the second half from the first' });
  }

  // taxable + tax must equal the discounted subtotal; grand must be a whole rupee when round-off applied
  const badMath = sql(`select id, invoice_number, taxable_subtotal, tax_total, discount_total, round_off, grand_total,
      round(taxable_subtotal + tax_total + discount_total + round_off, 2) recomputed
    from invoices where store_id in (${A.id},${B.id},${C.id},${E.id}) and status!='cancelled'
      and abs(grand_total - (taxable_subtotal + tax_total - discount_total + round_off)) > 0.005`);
  out.reconciliation.push({ check: 'grand_total identity', mismatches: badMath });

  // duplicate invoice numbers per counter
  const dupNum = sql(`select store_id, counter_code, invoice_number, count(*) c, group_concat(id) ids
    from invoices group by store_id, counter_code, invoice_number having c>1`);
  out.reconciliation.push({ check: 'duplicate invoice numbers per counter', duplicates: dupNum });
  if (dupNum.length) out.defects.push({ id: 'DUP-NUMBERS', severity: 'Critical', type: 'Data', module: 'Number series',
    title: 'Two saved bills share one invoice number within the same counter', actual: dupNum });

  // ledger vs batch balances
  const ledgerVsBatch = sql(`select b.id batch_id, b.batch_no, b.store_id, b.stock_qty,
      coalesce(sum(l.qty_delta),0) ledger_sum
    from product_batches b left join stock_ledger_entries l on l.batch_id=b.id
    group by b.id having round(b.stock_qty - coalesce(sum(l.qty_delta),0), 3) <> 0
    order by abs(b.stock_qty - coalesce(sum(l.qty_delta),0)) desc limit 20`);
  out.reconciliation.push({ check: 'batch qty vs ledger sum', mismatches: ledgerVsBatch });

  saveEvidence('K_reports.json', out);
  console.log('\n=== DEFECTS ===');
  for (const d of out.defects) console.log(`${d.severity} | ${d.module} | ${d.title}`);
})().catch(e => { console.error(e); saveEvidence('K_reports.json', out); process.exit(1); });
