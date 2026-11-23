const { api, evidence } = require('./lib.cjs');
(async () => {
  const probes = [
    ['GET','/invoices'],['GET','/invoices/1'],['GET','/customers'],['GET','/customers/1'],['GET','/held-bills'],['GET','/settings'],
    ['GET','/sync/pull/deltas'],['GET','/device-sessions'],['GET','/devices/connected'],['GET','/counters'],['GET','/counters/1/watch'],['GET','/branches'],
    ['GET','/inventory/negative-stock-report'],['GET','/whatsapp/config'],['GET','/whatsapp/sessions'],['GET','/price-lists/resolve?product_id=1'],
    ['GET','/license/check'],['GET','/store'],['GET','/products'],['GET','/reports/daily-summary'],
    ['POST','/invoices',{}],['POST','/customers',{name:'QA NoAuth Probe',phone:'9000000001'}],['POST','/held-bills',{}],
    ['POST','/counters/1/lease-sequence',{}],['POST','/stores/day-close',{}],['POST','/device-sessions/1/unlock',{}],['POST','/device-sessions/1/rename',{name:'x'}],
    ['POST','/invoices/1/cancel',{reason:'probe'}],['POST','/invoices/1/lock',{}],['POST','/invoices/1/approvals/verify',{}],['POST','/settings',{}],
    ['POST','/whatsapp/send-invoice',{}],['POST','/staff/logout',{}],['POST','/device-sessions/heartbeat',{}],
  ];
  const out = [];
  for (const [m,u,b] of probes) {
    const r = await api(m,u,b);
    const leak = r.status===200 || r.status===201;
    out.push({ method:m, url:u, status:r.status, leak, sample:(r.text||'').slice(0,240) });
    console.log(`${leak?'LEAK':'    '} ${m} ${u} -> ${r.status} ${(r.text||'').slice(0,110).replace(/\s+/g,' ')}`);
  }
  evidence('SEC_noauth_probe', out);
})();
