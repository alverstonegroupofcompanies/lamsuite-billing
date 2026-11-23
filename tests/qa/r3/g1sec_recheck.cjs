// G1-SEC re-check on the live test backend: SEC-04 cross-store sale, SEC-05 locked counter + attribution, SEC-01 anonymous cancel
const { api, sql, evidence, adminToken } = require('./lib.cjs');
const { issueCode } = require('./pos.cjs');
(async () => {
  const ev = {};
  const t = await adminToken();
  const code = await issueCode(3, 4);
  const cl = await api('POST', '/counters/claim', { code, device_uuid: `qa-g1sec-${Date.now()}`, device_name: 'QA G1 recheck' });
  const C = { device: cl.json.device_token };
  const bill = (over) => Object.assign({ external_id: `g1_${Date.now()}_${Math.random()}`, invoice_date: '2026-11-22', customer_name: 'Walk-in Customer', payment_mode: 'Cash', paid_amount: 115, payments: [{ mode: 'Cash', amount: 115 }], tax_mode: 'inclusive', grand_total: 115,
    items: [{ product_id: '6', product_name: 'QA Cough Syrup 100ml', batch_id: '13', batch_no: 'CS-B2', qty: 1, loose_qty: 0, units_per_pack: 1, unit_price: 115, mrp: 120, gst_percent: 12 }] }, over);

  // SEC-04: QA-PH counter sells QA-CS lipstick
  const lipBefore = sql('select stock_qty from product_batches where id=10')[0].stock_qty;
  const x = await api('POST', '/invoices', bill({ paid_amount: 90, payments: [{ mode: 'Cash', amount: 90 }], grand_total: 90, items: [{ product_id: '9', product_name: 'QA Ruby Lipstick', batch_id: '10', batch_no: 'LP-01', qty: 1, loose_qty: 0, units_per_pack: 1, unit_price: 90, mrp: 450, gst_percent: 12 }] }), C);
  ev.cross_store = { st: x.status, body: x.text.slice(0, 200), lip: [lipBefore, sql('select stock_qty from product_batches where id=10')[0].stock_qty] };

  // SEC-05 attribution: payload names C09, bill must be C02 (counter 3); no counter invented
  const countersBefore = sql('select count(*) n from counters')[0].n;
  const a = await api('POST', '/invoices', bill({ counter_code: 'C09', invoice_number: `C09-G1-${Date.now()}` }), C);
  const inv = a.json && a.json.invoice;
  ev.attribution = { st: a.status, counter_id: inv && inv.counter_id, counter_code: inv && inv.counter_code, counters_created: sql('select count(*) n from counters')[0].n - countersBefore };

  // SEC-05 locked counter cannot bill
  await api('POST', '/admin/counters/3/lock', { reason: 'G1 recheck' }, { token: t, store: 4 });
  const l = await api('POST', '/invoices', bill({}), C);
  ev.locked = { st: l.status, body: l.text.slice(0, 160) };
  await api('POST', '/admin/counters/3/unlock', {}, { token: t, store: 4 });

  // SEC-01: anonymous cancel and another store's invoice through this counter
  const foreign = sql("select id,status from invoices where store_id=5 and status!='cancelled' limit 1")[0];
  ev.anon_cancel = (await api('POST', `/invoices/${foreign.id}/cancel`, { reason: 'anon' })).status;
  ev.cross_store_read = (await api('GET', `/invoices/${foreign.id}`, undefined, C)).status;
  ev.cross_store_cancel = (await api('POST', `/invoices/${foreign.id}/cancel`, { reason: 'x' }, C)).status;
  ev.foreign_status_after = sql(`select status from invoices where id=${foreign.id}`)[0].status;
  console.log(JSON.stringify(ev, null, 1));
  evidence('G1SEC_recheck', ev);
})();
