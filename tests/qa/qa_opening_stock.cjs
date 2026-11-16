/**
 * Fixture: opening stock for the controlled QA stores, written directly to the throwaway DB.
 * (Purchase entry is tested separately through the UI; this only establishes a known starting
 *  batch position so that billing/return/adjustment scenarios are deterministic.)
 *
 * Each QA product gets two batches:
 *   B1 = 120 units, expiry 2028-06-30 (long-dated)
 *   B2 =  60 units, expiry 2026-12-20 (near expiry -> FEFO must pick this first)
 */
const { execSync } = require('child_process');
const path = require('path');
const manifest = require('./manifest.json');
const DB = path.resolve(__dirname, 'qa_fresh.sqlite');

const run = (sql) => execSync(`sqlite3 "${DB}" "${sql.replace(/"/g, '""')}"`, { encoding: 'utf8' });
const q = (sql) => {
  const out = execSync(`sqlite3 -json "${DB}" "${sql.replace(/"/g, '""')}"`, { encoding: 'utf8' }).trim();
  return out ? JSON.parse(out) : [];
};

let made = 0;
for (const [code, s] of Object.entries(manifest.stores)) {
  if (!code.startsWith('QA-') || !s.products) continue;
  const counter = q(`select id, counter_code from counters where store_id=${s.id} order by id limit 1`)[0] || { id: 1, counter_code: 'C01' };
  for (const p of Object.values(s.products)) {
    const exists = q(`select id from product_batches where product_id=${p.id}`);
    if (exists.length) continue;
    const upp = p.units_per_pack || 1;
    const plan = [
      { batch: `${code}-LONG-01`, qty: 120, expiry: '2028-06-30' },
      { batch: `${code}-NEAR-01`, qty: 60, expiry: '2026-12-20' },
    ];
    let running = 0;
    for (const b of plan) {
      run(`insert into product_batches (store_id,product_id,batch_no,mfg_date,expiry_date,stock_qty,mrp,purchase_rate,selling_rate,external_id,version,created_at,updated_at)
           values (${s.id},${p.id},'${b.batch}','2026-01-01','${b.expiry}',${b.qty},${p.mrp},${p.sel_rate},${p.sel_rate},'fx_${p.id}_${b.batch}',1,datetime('now'),datetime('now'));`);
      const bid = q(`select id from product_batches where store_id=${s.id} and product_id=${p.id} and batch_no='${b.batch}'`)[0].id;
      running += b.qty;
      run(`insert into stock_ledger_entries (store_id,product_id,batch_id,counter_id,counter_code,location_name,event_type,qty_delta,reference_type,reference_id,is_reconciled_negative,balance_after,staff_user_id,created_at,updated_at)
           values (${s.id},${p.id},${bid},${counter.id},'${counter.counter_code}','QA Fixture','PURCHASE',${b.qty},'FIXTURE','0',0,${running},${s.users?.pur?.id ?? 1},datetime('now'),datetime('now'));`);
      made++;
    }
    run(`update products set current_stock=${running}, updated_at=datetime('now') where id=${p.id};`);
  }
  console.log(`${code}: batches seeded for ${Object.keys(s.products).length} products`);
}
console.log(`total batch rows created: ${made}`);
console.log(q(`select p.store_id, count(*) batches, sum(b.stock_qty) units from product_batches b join products p on p.id=b.product_id where p.name like 'QA %' group by p.store_id`)
  .map(r => JSON.stringify(r)).join('\n'));
