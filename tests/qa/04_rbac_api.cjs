/**
 * Groups H/I — authentication, roles, tenant isolation, and unauthenticated surface,
 * exercised directly against the API the way an attacker or a curious clerk would.
 * Read-mostly: any scenario that writes lands in store 1 (the seeded store) so it cannot
 * disturb the money scenarios running in parallel.
 */
const { sql, sqlOne, saveEvidence, BACKEND } = require('./driver.cjs');
const manifest = require('./manifest.json');

const J = { 'Content-Type': 'application/json', Accept: 'application/json' };
const out = { probes: [], defects: [] };

async function call(method, url, { token, body, headers = {}, expect } = {}) {
  const H = { ...J, ...headers };
  if (token) H.Authorization = `Bearer ${token}`;
  let res, json, text;
  try {
    res = await fetch(`${BACKEND}${url}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    text = await res.text();
    try { json = JSON.parse(text); } catch { json = text.slice(0, 400); }
  } catch (e) { json = String(e); res = { status: 0 }; }
  const rec = { method, url, status: res.status, request: body || null,
    response: typeof json === 'string' ? json : JSON.stringify(json).slice(0, 700) };
  out.probes.push(rec);
  console.log(`${res.status} ${method} ${url}`);
  // `json` is the untruncated body for assertions; non-enumerable so the evidence file stays small.
  Object.defineProperty(rec, 'json', { value: json, enumerable: false });
  return rec;
}

/** Parsed response body (the `response` string is truncated for the evidence file). */
function pj(r) {
  if (!r) return null;
  const j = r.json !== undefined ? r.json : (() => { try { return JSON.parse(r.response); } catch { return null; } })();
  return (j && typeof j === 'object') ? j : null;
}

const shape = (j) => {
  if (!j || typeof j !== 'object') return null;
  const d = j.data ?? j;
  if (Array.isArray(d)) return { rows: d.length, sample: d[0] };
  if (d && typeof d === 'object') return { keys: Object.keys(d).slice(0, 25) };
  return null;
};

(async () => {
  const A = manifest.stores['QA-A'], B = manifest.stores['QA-B'], C = manifest.stores['QA-C'];

  // --- tokens ---
  const admin = await call('POST', '/api/login', { body: { email: 'admin@lamstone.in', password: 'password123' } });
  const adminToken = (pj(admin) && pj(admin).token) || null;
  const cash = await call('POST', '/api/staff/login', { body: { store_id: A.id, user_id: A.users.cash.id, username: A.users.cash.username, pin: A.users.cash.pin } });
  const cashBody = pj(cash) || {};
  const cashToken = cashBody.token || (cashBody.data && cashBody.data.token);
  const acct = await call('POST', '/api/staff/login', { body: { store_id: A.id, user_id: A.users.acct.id, username: A.users.acct.username, pin: A.users.acct.pin } });
  const acctBody = pj(acct) || {};
  const acctToken = acctBody.token || (acctBody.data && acctBody.data.token);
  console.log('\ncashier token:', !!cashToken, 'role:', cashBody.role, cashBody.user && cashBody.user.role);
  console.log('accountant token:', !!acctToken);

  // --- I5 unauthenticated surface ---
  const oc = await call('GET', `/api/staff/offline-cache?store_id=${A.id}`);
  const ocRows = (() => { const j = pj(oc) || {}; const arr = j.data || j; return Array.isArray(arr) ? arr : []; })();
  const full = await call('GET', `/api/staff/offline-cache?store_id=${A.id}`);
  const fullArr = (() => { const j = pj(full) || {}; return j.data || j; })();
  const leakedHashes = Array.isArray(fullArr) ? fullArr.filter(u => u.password_hash || u.pin_hash) : [];
  out.probes[out.probes.length - 2].note = `unauthenticated offline-cache returned ${ocRows.length} staff rows, ${leakedHashes.length} with credential hashes`;
  if (leakedHashes.length) {
    out.defects.push({ id: 'OFFLINECACHE', severity: 'Critical', type: 'Security', module: 'Auth',
      title: 'GET /api/staff/offline-cache is public and returns bcrypt password + PIN hashes for all store staff',
      actual: { rows: ocRows.length, with_hashes: leakedHashes.length, sample: leakedHashes.slice(0, 2) },
      expected: 'Hashes must never leave the server; the offline cache should ship a verifiable, non-reversible token or require the device token.' });
  }
  await call('GET', '/api/invoices');
  await call('GET', '/api/sync/pull/deltas?store_id=4&since_watermark=0');
  const deltas = out.probes[out.probes.length - 1];
  try {
    const j = pj(deltas) || {};
    const counts = {};
    for (const k of Object.keys(j)) if (Array.isArray(j[k])) counts[k] = j[k].length;
    const storeIds = new Set([
      ...(j.products || []).map(x => x.store_id),
      ...(j.batches || j.product_batches || []).map(x => x.store_id),
      ...(j.parties || []).map(x => x.store_id),
    ]);
    deltas.note = `master delta counts ${JSON.stringify(counts)}; store ids present ${[...storeIds].join(',')}`;
    if (storeIds.size > 1) out.defects.push({ id: 'DELTAS-SCOPE', severity: 'Critical', type: 'Security', module: 'Sync',
      title: 'sync/pull/deltas returns every tenant\'s master data regardless of store_id',
      actual: { store_ids_returned: [...storeIds], counts },
      expected: 'Only rows belonging to the requesting store.' });
  } catch (e) { deltas.note = 'could not parse delta payload: ' + e.message; }
  await call('POST', '/api/settings', { body: { store_id: B.id, company_name: 'QA TAMPERED SETTINGS' } });
  await call('GET', '/api/counters');
  await call('GET', '/api/branches');

  // --- I2 role enforcement through the API (cashier) ---
  const cashierTargets = [
    ['GET', `/api/admin/invoices?store_id=${A.id}`],
    ['GET', `/api/admin/products?store_id=${A.id}`],
    ['GET', `/api/admin/reports/sales?store_id=${A.id}`],
    ['GET', `/api/admin/audit-logs?store_id=${A.id}`],
    ['GET', `/api/admin/users?store_id=${A.id}`],
    ['GET', `/api/admin/devices?store_id=${A.id}`],
    ['GET', `/api/admin/stores`],
    ['POST', `/api/admin/products`, { name: 'QA Cashier Should Not Create', barcode: '9000000000001', mrp: 1, sel_rate: 1, gst_percent: 0, units_per_pack: 1, store_id: A.id }],
    ['DELETE', `/api/admin/invoices/1`],
    ['POST', `/api/admin/stock-adjust`, { store_id: A.id, product_id: 1, qty: 100 }],
  ];
  for (const [m, u, b] of cashierTargets) {
    const r = await call(m, u, { token: cashToken, body: b });
    r.role = 'cashier';
    r.verdict = r.status === 403 ? 'blocked' : (r.status >= 200 && r.status < 300 ? 'ALLOWED (defect)' : `other(${r.status})`);
    if (r.verdict.startsWith('ALLOWED')) {
      out.defects.push({ id: `RBAC-${m}-${u}`, severity: m === 'DELETE' || m === 'POST' ? 'Critical' : 'High', type: 'Security', module: 'RBAC',
        title: `Cashier PIN token is permitted to ${m} ${u}`, actual: { status: r.status, response: r.response.slice(0, 300) },
        expected: '403 for a Cashier role.' });
    }
  }

  // --- I3/I4 tenant isolation with a store-A token asking for store B ---
  const isoTargets = [
    ['GET', `/api/admin/invoices?store_id=${B.id}`],
    ['GET', `/api/admin/products?store_id=${B.id}`],
    ['GET', `/api/admin/parties?store_id=${B.id}`],
    ['GET', `/api/settings?store_id=${B.id}`],
    ['GET', `/api/counters?store_id=${B.id}`],
    // the POS-scoped list endpoints a workstation actually uses
    ['GET', `/api/invoices?store_id=${B.id}`],
    ['GET', `/api/products?store_id=${B.id}`],
    ['GET', `/api/purchases?store_id=${B.id}`],
    ['GET', `/api/sync/pull/deltas?store_id=${B.id}&since_watermark=0`],
  ];
  for (const [m, u] of isoTargets) {
    const r = await call(m, u, { token: cashToken, headers: { 'X-Store-Id': String(B.id) } });
    r.role = 'storeA-token asking storeB';
    const other = (() => {
      const j = pj(r) || {}; const arr = j.data && Array.isArray(j.data) ? j.data : (Array.isArray(j) ? j : (j.products || j.invoices || j.counters || []));
      const ids = new Set((arr || []).map(x => x && x.store_id).filter(Boolean).map(String));
      if (j.store_id) ids.add(String(j.store_id));
      return ids;
    })();
    r.foreign_store_ids = [...other].filter(x => String(x) !== String(A.id));
    r.rows_returned = (() => { const j = pj(r) || {}; const arr = j.data || j.counters || j.products || j.invoices || []; return Array.isArray(arr) ? arr.length : null; })();
    if (r.status === 200 && r.foreign_store_ids.length) {
      out.defects.push({ id: `ISO-${u}`, severity: 'Critical', type: 'Security', module: 'Tenant isolation',
        title: `A Cashier token from store ${A.id} reads store ${B.id}'s data from ${u}`,
        actual: { status: r.status, foreign_store_ids: r.foreign_store_ids, rows_returned: r.rows_returned, sample: r.response.slice(0, 260) },
        expected: `Only store ${A.id} rows (or 403). The X-Store-Id header and the token's own store must both be honoured.` });
    }
  }

  // admin-panel endpoints are meant to be global for the super admin — record, do not flag.
  for (const [m, u] of [['GET', '/api/admin/invoices?store_id=' + B.id], ['GET', '/api/admin/stores']]) {
    const r = await call(m, u, { token: adminToken }); r.role = 'super_admin (expected allowed)';
  }

  // --- H1 staff lockout: user qaa_locky has max_failed_logins 3 ---
  // The lockout is a state machine, so the fixture is reset first; otherwise a repeat run only
  // ever sees the already-locked answer and proves nothing.
  sql(`update users set failed_login_attempts=0, locked_until=null where id=${A.users.locky.id}`);
  const lockAttempts = [];
  for (let i = 0; i < 5; i++) {
    // 0000/1234/1111 are the dev-backdoor PINs (F16) and would log in instead of failing, so use a genuinely wrong PIN.
    const r = await call('POST', '/api/staff/login', { body: { store_id: A.id, pin: '0001', user_id: A.users.locky.id } });
    lockAttempts.push({ attempt: i + 1, status: r.status, body: r.response.slice(0, 160) });
    if (i === 4) r.note = 'final attempt after exceeding max_failed_logins';
  }
  const lockRow = sql(`select id,username,failed_login_attempts,max_failed_logins,locked_until from users where id=${A.users.locky.id}`);
  out.probes.push({ probe: 'locky user row after 5 failed PINs', lockRow });
  out.probes.push({ probe: 'H1 lockout trace', attempts: lockAttempts });
  const goodLocky = await call('POST', '/api/staff/login', { body: { store_id: A.id, pin: A.users.locky.pin, user_id: A.users.locky.id } });
  goodLocky.note = 'correct PIN after lockout';
  const lockedOk = lockAttempts.slice(0, 3).every(a => a.status >= 400 && a.status < 420)
    && lockAttempts.slice(3).every(a => a.status === 423 || a.status === 429)
    && goodLocky.status >= 400;
  out.scenarios = out.scenarios || [];
  out.scenarios.push({ id: 'H1', title: 'Repeated wrong PINs lock the staff account and the correct PIN stays refused',
    status: lockedOk ? 'PASS' : 'CHECK', evidence: { attempts: lockAttempts, correct_pin_after_lockout: goodLocky.status, user_row: lockRow } });
  if (!lockedOk) {
    out.defects.push({ id: 'LOCKOUT', severity: 'High', type: 'Security', module: 'Auth',
      title: 'Staff PIN lockout does not behave as configured (max_failed_logins)', actual: { attempts: lockAttempts, correct_pin_after_lockout: goodLocky.status, user_row: lockRow } });
  }

  // --- H2 no dev backdoor in a non-debug build? record the app env first ---
  const cfg = await call('GET', '/api/health');
  const back = await call('POST', '/api/staff/login', { body: { store_id: A.id, pin: '1234', user_id: A.users.owner.id } });
  out.probes[out.probes.length - 2].note = 'backdoor PIN 1234 result in the current environment (owner real PIN is ' + A.users.owner.pin + ')';
  out.scenarios.push({ id: 'H2', title: 'Only the staff member\'s own PIN authenticates (no shared/universal PIN)',
    status: back.status === 200 ? 'FAIL' : 'PASS', evidence: { universal_pin_1234: back.status, body: back.response.slice(0, 300) } });
  if (back.status === 200) {
    out.defects.push({ id: 'BACKDOOR-PIN', severity: 'Critical', type: 'Security', module: 'Auth',
      title: 'Universal PIN "1234" signs in as any staff user on this build, and the server rewrites that user\'s stored PIN hash to the backdoor value',
      expected: 'Only the PIN the owner enrolled. Development bypasses must be compiled out of, or gated off for, any backend reachable by a workstation.',
      actual: { http_status: 200, response: back.response.slice(0, 300), owner_real_pin: A.users.owner.pin },
      suspected: 'backend/app/Http/Controllers/Api/StaffAuthController.php:199-228 (environment(local,testing)||config(app.debug) branch, then $user->forceFill pin_hash)' });
    const pinNow = sql(`select id, username, pin_hash from users where id=${A.users.owner.id}`);
    out.probes.push({ probe: 'owner pin_hash after the backdoor login', pinNow, note: 'the stored hash is replaced by the backdoor value, so the owner\'s own PIN stops working' });
  }

  saveEvidence('HI_auth_rbac.json', out);
  console.log('\n=== DEFECTS ===');
  for (const d of out.defects) console.log(`${d.severity} | ${d.module} | ${d.title}`);
})().catch(e => { console.error(e); saveEvidence('HI_auth_rbac.json', out); process.exit(1); });
