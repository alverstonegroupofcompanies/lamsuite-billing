// J11 admin parity per store, alerts, audit coverage of sensitive actions, store suspension
const { api, sql, evidence, state, adminToken, sleep } = require('./lib.cjs');
(async () => {
  const st = state(); const ev = {};
  const t = await adminToken();
  // parity: invoices / products / parties / purchases listed under each store only
  for (const sid of [4, 5]) {
    const H = { token: t, store: sid };
    const inv = await api('GET', `/admin/invoices?store_id=${sid}&per_page=200`, undefined, H);
    const prods = await api('GET', `/admin/products?store_id=${sid}&per_page=200`, undefined, H);
    const db = { inv: sql(`select count(*) n from invoices where store_id=${sid}`)[0].n, prods: sql(`select count(*) n from products where store_id=${sid}`)[0].n };
    const invRows = (inv.json && (inv.json.data || inv.json.invoices)) || [];
    const prodRows = (prods.json && (prods.json.data || prods.json.products)) || [];
    ev['store_' + sid] = { invoices_api: invRows.length, invoices_db: db.inv, foreign_invoices: invRows.filter((r) => Number(r.store_id) !== sid).map((r) => r.invoice_number), products_api: prodRows.length, products_db: db.prods, foreign_products: prodRows.filter((r) => Number(r.store_id) !== sid).map((r) => r.name) };
    console.log('store', sid, JSON.stringify(ev['store_' + sid]));
  }
  // export parity (CSV) for QA-PH invoices
  const ex = await api('GET', '/admin/reports/sales?store_id=4&from=2026-11-21&to=2026-11-21&format=csv', undefined, { token: t, store: 4 });
  ev.sales_report = { st: ex.status, head: ex.text.slice(0, 400) };
  // alerts / notifications
  ev.notifications = sql("select store_id,type,title from notifications where store_id in (4,5) order by id desc limit 20");
  ev.alert_lockout = sql("select count(*) n from notifications where type like '%activation%' or title like '%activation%' or title like '%enrol%'")[0].n;
  console.log('notifications', JSON.stringify(ev.notifications).slice(0, 800));
  // audit coverage of sensitive actions done in this run
  const actions = sql("select action,count(*) n from audit_logs where store_id in (4,5) group by action order by action");
  ev.audit_actions = actions;
  const want = ['create_store', 'counter_activation_code_issued', 'counter_claimed', 'counter_reissued', 'invoice_cancelled', 'cancel_invoice', 'purchase', 'stock_adjust', 'update_stock_adjustment_policy', 'counter_locked', 'lock_counter', 'invoice_approval_issued', 'create_product', 'transfer', 'day_close', 'unlock_pin'];
  ev.audit_missing = want.filter((w) => !actions.some((a) => a.action.includes(w.replace(/_$/, ''))));
  console.log('audit actions', JSON.stringify(actions));
  console.log('audit missing (by keyword)', JSON.stringify(ev.audit_missing));
  // store suspension: disable QA-CS, CS counter must be blocked
  const CS = { device: st.apiTillCS.token, token: st.apiTillCS.token };
  ev.cs_before = (await api('GET', '/store', undefined, CS)).status;
  const dis = await api('PUT', '/admin/stores/5', { is_active: false }, { token: t, store: 5 });
  ev.disable = { st: dis.status, body: dis.text.slice(0, 200) };
  const t0 = Date.now(); let blockedAt = null; const probes = [];
  for (let i = 0; i < 12; i++) { const r = await api('GET', '/store', undefined, CS); probes.push(r.status); if (r.status >= 400) { blockedAt = (Date.now() - t0) / 1000; break; } await sleep(5000); }
  ev.cs_blocked_after_s = blockedAt; ev.cs_probes = probes;
  const sale = await api('POST', '/invoices', { store_id: '5', external_id: 'qa_suspended_1', invoice_number: 'C02-INV-SUSP', invoice_date: '2026-11-21', customer_name: 'Walk-in Customer', payment_mode: 'Cash', paid_amount: 472, payments: [{ mode: 'Cash', amount: 472 }], grand_total: 472, items: [{ product_id: '9', product_name: 'QA Ruby Lipstick', batch_id: '10', batch_no: 'LP-01', qty: 1, loose_qty: 0, units_per_pack: 1, unit_price: 400, mrp: 450, gst_percent: 18 }] }, CS);
  ev.sale_while_suspended = { st: sale.status, body: sale.text.slice(0, 160) };
  const en = await api('PUT', '/admin/stores/5', { is_active: true }, { token: t, store: 5 });
  ev.enable = en.status;
  console.log('suspend', JSON.stringify({ disable: ev.disable.st, blocked_after_s: blockedAt, probes, sale_while_suspended: ev.sale_while_suspended, enable: en.status }));
  evidence('J11_admin', ev);
})();
