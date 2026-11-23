// G11-TAX isolated-environment setup: parties + two claimed API tills (my throwaway DB only).
const { api, sql, evidence, state, saveState, adminToken } = require('./lib.cjs');
const { issueCode } = require('./pos.cjs');

const PARTIES = [
  { store_id: 4, type: 'customer', name: 'QA Credit Customer', phone: '9000000101', credit_limit: 1000, opening_balance: 0 },
  { store_id: 4, type: 'customer', name: 'QA No Credit Customer', phone: '9000000102', credit_limit: 0, opening_balance: 0 },
  { store_id: 4, type: 'supplier', name: 'QA Pharma Distributors', phone: '9000000103', gstin: '32AAACQ1234A1Z1', credit_limit: 0, opening_balance: 0 },
  { store_id: 5, type: 'customer', name: 'QA Beauty Client', phone: '9000000201', credit_limit: 2000, opening_balance: 0 },
];

(async () => {
  const st = state();
  const ev = { parties: [], tills: {} };

  for (const p of PARTIES) {
    if (sql(`select id from parties where name='${p.name}'`).length) continue;
    const r = await api('POST', '/admin/parties', p, { store: p.store_id, token: await adminToken() });
    ev.parties.push({ name: p.name, st: r.status, id: r.json?.id ?? r.json?.data?.id ?? null });
  }

  for (const [key, counterId, storeId, uuid] of [
    ['apiTillPH', 2, 4, 'qa-g11-till-ph-c02'],
    ['apiTillCS', 4, 5, 'qa-g11-till-cs-c02'],
  ]) {
    if (st[key]?.token) continue;
    const code = await issueCode(counterId, storeId);
    const c = await api('POST', '/counters/claim', { code, device_uuid: uuid, device_name: 'QA G11 till' });
    ev.tills[key] = { st: c.status, counterId, storeId };
    st[key] = { counterId, storeId, token: c.json && c.json.device_token };
    saveState(st);
  }

  evidence('G11_setup', ev);
  console.log(JSON.stringify(ev));
})();
