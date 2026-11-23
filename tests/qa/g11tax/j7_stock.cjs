// J7.01-J7.03 adjustments under admin policy, physical count, negative stock, inter-store transfer
const { api, sql, evidence, state, saveState, adminToken } = require('./lib.cjs');
const { issueCode } = require('./pos.cjs');
const bal = (id) => sql(`select stock_qty from product_batches where id=${id}`)[0].stock_qty;
const led = (id) => sql(`select coalesce(sum(qty_delta),0) s from stock_ledger_entries where batch_id=${id}`)[0].s;
(async () => {
  const st = state(); const ev = {};
  const t = await adminToken(); const A = { token: t, store: 4 };
  const C = { device: st.apiTillPH.token, token: st.apiTillPH.token };
  // admin policy: approval above 100 units per document, max 3 documents per day, notes required
  const pol = await api('PUT', '/admin/stock-adjustments/policy', { store_id: 4, approval_threshold_qty: 100, max_documents_per_day: 3, require_notes: true, allow_negative_stock: false }, A);
  ev.policy = { st: pol.status, body: pol.text.slice(0, 300) };
  const B = 11; // PA-NEW batch (tablets)
  const step = async (label, body) => {
    const before = { bal: bal(B), led: led(B) };
    const r = await api('POST', '/stock/adjustments', { store_id: 4, ...body }, C);
    const after = { bal: bal(B), led: led(B) };
    ev[label] = { st: r.status, body: r.text.slice(0, 350), before, after };
    console.log(label, r.status, r.text.slice(0, 200).replace(/\s+/g, ' '), '| bal', before.bal, '->', after.bal, '| ledger sum', after.led);
  };
  await step('adj_minus10_no_notes', { mode: 'adjustment', reason: 'Damage', lines: [{ product_id: 5, batch_id: B, batch_no: 'PA-NEW', adjustment_qty: -10, unit_cost: 4 }] });
  await step('adj_minus10', { mode: 'adjustment', reason: 'Damage', notes: 'QA broken strips', lines: [{ product_id: 5, batch_id: B, batch_no: 'PA-NEW', adjustment_qty: -10, unit_cost: 4 }] });
  await step('adj_plus120_should_hold', { mode: 'adjustment', reason: 'Found', notes: 'QA found stock', lines: [{ product_id: 5, batch_id: B, batch_no: 'PA-NEW', adjustment_qty: 120, unit_cost: 4 }] });
  await step('adj_minus5000_negative', { mode: 'adjustment', reason: 'Damage', notes: 'QA too much', lines: [{ product_id: 5, batch_id: B, batch_no: 'PA-NEW', adjustment_qty: -5000, unit_cost: 4 }] });
  await step('adj_doc4_daily_limit', { mode: 'adjustment', reason: 'Damage', notes: 'QA 4th doc', lines: [{ product_id: 5, batch_id: B, batch_no: 'PA-NEW', adjustment_qty: -1, unit_cost: 4 }] });
  await step('adj_doc5_daily_limit', { mode: 'adjustment', reason: 'Damage', notes: 'QA 5th doc', lines: [{ product_id: 5, batch_id: B, batch_no: 'PA-NEW', adjustment_qty: -1, unit_cost: 4 }] });
  ev.docs = sql('select * from stock_adjustment_documents order by id desc limit 8');
  // approval inbox in the admin panel API
  const pend = await api('GET', '/admin/stock-adjustments?status=pending', undefined, A);
  ev.pending_list = { st: pend.status, body: pend.text.slice(0, 500) };
  // physical count on CS-B2 (bottle) set to 10
  const cb = sql("select id,stock_qty from product_batches where batch_no='CS-B2'")[0];
  const pc = await api('POST', '/stock/adjustments', { store_id: 4, mode: 'physical_count', reason: 'Audit', notes: 'QA count', lines: [{ product_id: 6, batch_id: cb.id, batch_no: 'CS-B2', counted_qty: 10, unit_cost: 60 }] }, C);
  ev.physical_count = { st: pc.status, body: pc.text.slice(0, 300), before: cb.stock_qty, after: bal(cb.id), ledger_sum: led(cb.id) };
  console.log('physical count', pc.status, cb.stock_qty, '->', bal(cb.id), 'ledger', led(cb.id));
  // transfer PH -> CS: 30 tablets of QA Paracet (same barcode exists in CS as a different product: QA Glow Face Cream)
  const before = { ph: bal(B), cs_face: sql('select coalesce(sum(stock_qty),0) s from product_batches where product_id=8')[0].s };
  const d = await api('POST', '/stock/transfers', { store_id: 4, to_store_id: 5, notes: 'QA transfer', lines: [{ product_id: 5, batch_no: 'PA-NEW', qty: 30 }] }, C);
  const tr = d.json && (d.json.transfer || d.json.data);
  ev.dispatch = { st: d.status, body: d.text.slice(0, 600), ph_before: before.ph, ph_after: bal(B) };
  console.log('dispatch', d.status, d.text.slice(0, 200), 'PH', before.ph, '->', bal(B));
  // receive at QA-CS with its own counter token
  const code = await issueCode(5, 5);
  const cl = await api('POST', '/counters/claim', { code, device_uuid: 'qa-api-till-cs-c02', device_name: 'QA API till CS' });
  const CS = { device: cl.json.device_token, token: cl.json.device_token };
  st.apiTillCS = { counterId: 5, token: cl.json.device_token }; saveState(st);
  const tid = tr && (tr.id || tr.transfer_id);
  const list = await api('GET', '/stock/transfers', undefined, CS);
  ev.cs_transfer_list = { st: list.status, body: list.text.slice(0, 600) };
  const items = tid ? sql(`select * from stock_transfer_items where stock_transfer_id=${tid}`) : [];
  ev.items = items;
  const rec = await api('POST', `/stock/transfers/${tid}/receive`, { store_id: 5, lines: items.map((i) => ({ item_id: i.id, received_qty: 25 })) }, CS);
  ev.receive = { st: rec.status, body: rec.text.slice(0, 700), cs_face_before: before.cs_face, cs_face_after: sql('select coalesce(sum(stock_qty),0) s from product_batches where product_id=8')[0].s,
    cs_batches: sql("select id,product_id,batch_no,stock_qty from product_batches where store_id=5"), cs_products: sql('select id,name,barcode,current_stock from products where store_id=5'),
    transfer: tid ? sql(`select * from stock_transfers where id=${tid}`) : [], ledger: sql("select store_id,product_id,batch_id,event_type,qty_delta,reference_type from stock_ledger_entries where event_type like '%TRANSFER%'") };
  console.log('receive', rec.status, rec.text.slice(0, 300));
  console.log('CS products', JSON.stringify(ev.receive.cs_products), 'CS batches', JSON.stringify(ev.receive.cs_batches));
  console.log('transfer ledger', JSON.stringify(ev.receive.ledger), 'transfer row', JSON.stringify(ev.receive.transfer).slice(0, 400));
  evidence('J7_stock', ev);
})();
