/** M1 integrity checkpoint — read-only SQL over the throwaway QA database. */
const fs = require('fs');
const path = require('path');
const { sql } = require('./driver.cjs');

const q = (s) => sql(s);
const out = {
  captured_at: new Date().toISOString(),
  checks: {
    invoices_paid_ne_grand: q(`select invoice_number,store_id,grand_total,paid_amount from invoices where abs(round(coalesce(paid_amount,0)-grand_total,2))>0.009 and status!='cancelled' order by id`),
    invoices_tax_ne_line_sum: q(`select i.invoice_number,i.store_id,i.tax_total,(select round(coalesce(sum(tax_amount),0),2) from invoice_items it where it.invoice_id=i.id) line_tax from invoices i where abs(i.tax_total-(select coalesce(sum(tax_amount),0) from invoice_items it where it.invoice_id=i.id))>0.009 order by i.id`),
    invoices_paid_ne_payments: q(`select i.invoice_number,i.store_id,i.paid_amount,(select round(coalesce(sum(amount),0),2) from invoice_payments p where p.invoice_id=i.id) payments from invoices i where abs(coalesce(i.paid_amount,0)-(select coalesce(sum(amount),0) from invoice_payments p where p.invoice_id=i.id))>0.009 order by i.id`),
    duplicate_invoice_numbers: q(`select invoice_number,store_id,count(*) n from invoices group by invoice_number,store_id having n>1`),
    orphan_invoice_items: q(`select count(*) n from invoice_items where invoice_id not in (select id from invoices)`),
    orphan_invoice_payments: q(`select count(*) n from invoice_payments where invoice_id not in (select id from invoices)`),
    purchases_total: q(`select count(*) n from purchases`),
    purchase_batches_created: q(`select id,batch_no,store_id from product_batches where batch_no like 'QA-P%'`),
    purchase_stock_ledger_rows: q(`select count(*) n from stock_ledger_entries where reference_type like '%PURCHASE%' and created_at > '2026-11-14 01:00:00'`),
    transfer_stock_ledger_rows: q(`select count(*) n from stock_ledger_entries where reference_type like '%TRANSFER%'`),
    suppliers_with_balance: q(`select id,name,current_balance from parties where store_id=4 and type like '%supplier%' and current_balance > 0`),
    opening_batches_without_ledger: q(`select count(*) n from product_batches b where b.batch_no='OPENING' and not exists (select 1 from stock_ledger_entries l where l.batch_id=b.id)`),
    batches_negative: q(`select count(*) n from product_batches where stock_qty < 0`),
  },
};
fs.writeFileSync(path.resolve(__dirname, '../../test-reports/evidence/M_integrity.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.checks, null, 1).slice(0, 4000));
