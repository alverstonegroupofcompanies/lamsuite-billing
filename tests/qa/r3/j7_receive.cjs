// J7.03 receive transfer 1 at QA-CS: barcode matching (same barcode = different product there), short receipt
const { api, sql, evidence, state } = require('./lib.cjs');
(async () => {
  const st = state(); const ev = {};
  const CS = { device: st.apiTillCS.token, token: st.apiTillCS.token };
  const tid = 1;
  ev.transfer_before = sql(`select * from stock_transfers where id=${tid}`);
  const items = sql(`select * from stock_transfer_items where stock_transfer_id=${tid}`);
  ev.items = items;
  const list = await api('GET', '/stock/transfers', undefined, CS);
  ev.cs_list = { st: list.status, shows_transfer: /TRF-20261121/.test(list.text), body: list.text.slice(0, 500) };
  const before = { face: sql('select coalesce(sum(stock_qty),0) s from product_batches where product_id=8')[0].s, prods: sql('select count(*) n from products where store_id=5')[0].n };
  const rec = await api('POST', `/stock/transfers/${tid}/receive`, { store_id: 5, lines: items.map((i) => ({ item_id: i.id, received_qty: 25, shortage_reason: 'QA J7: five units short in transit' })) }, CS);
  ev.receive = { st: rec.status, body: rec.text.slice(0, 900) };
  ev.after = {
    transfer: sql(`select * from stock_transfers where id=${tid}`), items: sql(`select * from stock_transfer_items where stock_transfer_id=${tid}`),
    face_before: before.face, face_after: sql('select coalesce(sum(stock_qty),0) s from product_batches where product_id=8')[0].s,
    cs_products: sql('select id,name,barcode,current_stock,units_per_pack from products where store_id=5'), cs_batches: sql('select id,product_id,batch_no,stock_qty from product_batches where store_id=5'),
    mappings: sql('select * from transfer_product_mappings'), ledger: sql("select store_id,product_id,batch_id,event_type,qty_delta from stock_ledger_entries where event_type like '%TRANSFER%'"),
    ph_batch: sql('select stock_qty from product_batches where id=11')[0],
  };
  console.log('CS list shows transfer', ev.cs_list.st, ev.cs_list.shows_transfer);
  console.log('RECEIVE', rec.status, rec.text.slice(0, 500));
  console.log('AFTER', JSON.stringify(ev.after).slice(0, 2500));
  // cross-store receive attempt by QA-PH counter (should be refused)
  const PH = { device: st.apiTillPH.token, token: st.apiTillPH.token };
  const wrong = await api('POST', `/stock/transfers/${tid}/receive`, { lines: [] }, PH);
  ev.receive_by_source = { st: wrong.status, body: wrong.text.slice(0, 200) };
  console.log('receive by source store', wrong.status, wrong.text.slice(0, 160));
  evidence('J7_receive', ev);
})();
