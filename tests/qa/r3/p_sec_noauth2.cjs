const { api, sql, evidence } = require('./lib.cjs');
(async () => {
  const ev = {};
  ev.list_store2 = await api('GET','/invoices?store_id=2');
  ev.settings_store2 = await api('GET','/settings?store_id=2');
  ev.deltas_store2 = await api('GET','/sync/pull/deltas?store_id=2');
  const before = sql("select count(*) n from invoices where store_id=2")[0].n;
  ev.create_store2 = await api('POST','/invoices',{ store_id: 2, invoice_number: 'QA-NOAUTH-1', items:[{ product_id: 4, product_name:'Kochi Exclusive Wellness Tonic', qty:1, unit_price: 1, gst_percent: 18, total_amount: 1 }], grand_total: 1, payment_mode:'Cash' });
  ev.after = sql("select id,store_id,invoice_number,grand_total,status,counter_id,user_id from invoices where store_id=2 order by id desc limit 2");
  ev.before_count = before;
  for (const k of ['list_store2','settings_store2','deltas_store2','create_store2']) console.log(k, ev[k].status, ev[k].text.slice(0,220).replace(/\s+/g,' '));
  console.log('store2 invoices before', before, 'after', JSON.stringify(ev.after));
  evidence('SEC_noauth_probe2', ev);
})();
