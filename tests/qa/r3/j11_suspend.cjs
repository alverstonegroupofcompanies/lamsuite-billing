const { api, sql, evidence, state, adminToken, sleep } = require('./lib.cjs');
(async () => {
  const st = state(); const ev = {}; const t = await adminToken();
  const CS = { device: st.apiTillCS.token, token: st.apiTillCS.token };
  const dis = await api('POST', '/admin/stores/5/toggle-status', { reason: 'QA suspension test' }, { token: t, store: 5 });
  ev.disable = { st: dis.status, body: dis.text.slice(0, 200), is_active: sql('select is_active from stores where id=5')[0].is_active };
  const t0 = Date.now(); const probes = []; let blockedAt = null;
  for (let i = 0; i < 14; i++) { const r = await api('GET', '/store', undefined, CS); probes.push(r.status); if (r.status >= 400) { blockedAt = (Date.now() - t0) / 1000; break; } await sleep(5000); }
  ev.blocked_after_s = blockedAt; ev.probes = probes;
  const sale = await api('POST', '/invoices', { store_id: '5', external_id: 'qa_suspended_3', invoice_number: 'C02-INV-SUSP3', invoice_date: '2026-11-21', customer_name: 'Walk-in Customer', payment_mode: 'Cash', paid_amount: 472, payments: [{ mode: 'Cash', amount: 472 }], grand_total: 472, items: [{ product_id: '9', product_name: 'QA Ruby Lipstick', batch_id: '10', batch_no: 'LP-01', qty: 1, loose_qty: 0, units_per_pack: 1, unit_price: 400, mrp: 450, gst_percent: 18 }] }, CS);
  ev.sale_while_suspended = { st: sale.status, body: sale.text.slice(0, 200) };
  const hb = await api('POST', '/device-sessions/heartbeat', { device_uuid: 'qa-api-till-cs-c02', store_id: '5', counter_code: 'C02' }, CS);
  ev.heartbeat_while_suspended = { st: hb.status, body: hb.text.slice(0, 200) };
  const en = await api('POST', '/admin/stores/5/toggle-status', { reason: 'QA suspension test' }, { token: t, store: 5 });
  ev.enable = { st: en.status, is_active: sql('select is_active from stores where id=5')[0].is_active };
  console.log(JSON.stringify(ev).slice(0, 1500));
  evidence('J11_suspend', ev);
})();
