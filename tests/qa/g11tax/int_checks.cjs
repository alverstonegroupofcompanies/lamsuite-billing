// INT.01 integrity checks over the QA stores (4 = QA-PH, 5 = QA-CS); read-only SQL
const { sql, evidence } = require('./lib.cjs');
const S = '(4,5)';
const checks = {
  ledger_vs_batch: `select b.id,b.store_id,b.batch_no,b.stock_qty,coalesce(sum(l.qty_delta),0) ledger from product_batches b left join stock_ledger_entries l on l.batch_id=b.id where b.store_id in ${S} group by b.id having abs(b.stock_qty-coalesce(sum(l.qty_delta),0))>0.001`,
  product_vs_batches: `select p.id,p.store_id,p.name,p.current_stock,coalesce(sum(b.stock_qty),0) batches from products p left join product_batches b on b.product_id=p.id where p.store_id in ${S} group by p.id having abs(p.current_stock-coalesce(sum(b.stock_qty),0))>0.001`,
  ledger_store_mismatch: `select l.id,l.store_id ledger_store,b.store_id batch_store,l.event_type from stock_ledger_entries l join product_batches b on b.id=l.batch_id where l.store_id!=b.store_id`,
  negative_batches: `select id,store_id,batch_no,stock_qty from product_batches where store_id in ${S} and stock_qty<0`,
  orphan_items: `select ii.id from invoice_items ii left join invoices i on i.id=ii.invoice_id where i.id is null`,
  orphan_payments: `select p.id from invoice_payments p left join invoices i on i.id=p.invoice_id where i.id is null`,
  dup_invoice_numbers: `select store_id,invoice_number,count(*) c from invoices group by store_id,invoice_number having c>1`,
  dup_purchase_bills: `select store_id,supplier_id,invoice_number,module_key,count(*) c from purchases group by store_id,supplier_id,invoice_number,module_key having c>1`,
  header_tax_vs_lines: `select i.invoice_number,i.tax_total,round(sum(ii.tax_amount),2) lines from invoices i join invoice_items ii on ii.invoice_id=i.id where i.store_id in ${S} group by i.id having abs(i.tax_total-sum(ii.tax_amount))>0.005`,
  header_total_vs_lines: `select i.invoice_number,i.grand_total,round(sum(ii.total_amount),2) lines,i.round_off from invoices i join invoice_items ii on ii.invoice_id=i.id where i.store_id in ${S} group by i.id having abs(i.grand_total-sum(ii.total_amount)-coalesce(i.round_off,0))>0.005`,
  paid_vs_payments: `select i.invoice_number,i.paid_amount,round(coalesce(sum(p.amount),0),2) pays from invoices i left join invoice_payments p on p.invoice_id=i.id and p.payment_mode!='Credit' where i.store_id in ${S} and i.status!='cancelled' group by i.id having abs(i.paid_amount-coalesce(sum(p.amount),0))>0.005`,
  paid_gt_grand: `select invoice_number,grand_total,paid_amount from invoices where store_id in ${S} and paid_amount>grand_total+0.005`,
  invoice_cross_store_items: `select i.invoice_number,i.store_id inv_store,p.store_id product_store,p.name from invoice_items ii join invoices i on i.id=ii.invoice_id join products p on p.id=ii.product_id where i.store_id!=p.store_id`,
  invoice_counter_mismatch: `select i.invoice_number,i.store_id,i.counter_id,c.store_id counter_store,i.counter_code,c.counter_code real_code from invoices i join counters c on c.id=i.counter_id where i.store_id!=c.store_id or i.counter_code!=c.counter_code`,
  purchases_without_batches: `select pu.id,pu.invoice_number,pu.module_key,(select count(*) from stock_ledger_entries l where l.reference_type='PURCHASE' and l.reference_id=cast(pu.id as text)) ledger_rows from purchases pu where pu.store_id in ${S} and pu.module_key='purchase' and (select count(*) from stock_ledger_entries l where l.reference_type='PURCHASE' and l.reference_id=cast(pu.id as text))=0`,
  purchase_header_vs_lines: `select pu.invoice_number,pu.subtotal,round(sum(pi.taxable_amount),2) lines from purchases pu join purchase_items pi on pi.purchase_id=pu.id where pu.store_id in ${S} group by pu.id having abs(pu.subtotal-sum(pi.taxable_amount))>0.005`,
  supplier_balance_vs_docs: `select pa.id,pa.name,pa.current_balance,round(coalesce((select sum(grand_total-paid_amount) from purchases where supplier_id=pa.id and module_key='purchase'),0)-coalesce((select sum(amount) from supplier_payments where supplier_id=pa.id),0),2) derived from parties pa where pa.store_id in ${S} and pa.type='supplier' and abs(pa.current_balance-(coalesce((select sum(grand_total-paid_amount) from purchases where supplier_id=pa.id and module_key='purchase'),0)-coalesce((select sum(amount) from supplier_payments where supplier_id=pa.id),0)))>0.005`,
  customer_balance_vs_docs: `select pa.id,pa.name,pa.current_balance,round(coalesce((select sum(grand_total-paid_amount) from invoices where customer_id=pa.id and status!='cancelled' and module_key='invoice'),0)-coalesce((select sum(amount) from customer_payments where customer_id=pa.id),0),2) derived from parties pa where pa.store_id in ${S} and pa.type='customer' and abs(pa.current_balance-(coalesce((select sum(grand_total-paid_amount) from invoices where customer_id=pa.id and status!='cancelled' and module_key='invoice'),0)-coalesce((select sum(amount) from customer_payments where customer_id=pa.id),0)))>0.005`,
  cancelled_without_audit: `select i.invoice_number from invoices i where i.status='cancelled' and i.store_id in ${S} and not exists (select 1 from audit_logs a where a.entity_id=cast(i.id as text) and a.action like '%cancel%')`,
  timestamps_future_or_utc_drift: `select invoice_number,invoice_date,created_at from invoices where store_id in ${S} and (date(created_at)!=invoice_date)`,
};
(async () => {
  const out = {};
  for (const [k, q] of Object.entries(checks)) { const r = sql(q); out[k] = { count: r.length, rows: r.slice(0, 12) }; console.log(`${r.length ? 'FAIL' : 'ok  '} ${k}: ${r.length}  ${JSON.stringify(r.slice(0, 4)).slice(0, 360)}`); }
  evidence('INT_integrity', out);
})();
