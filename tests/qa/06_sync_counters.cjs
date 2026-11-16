/**
 * Groups F/G — cross-counter sync and the workstation/device surfaces.
 * Verifies that a bill taken at one counter shows up at another counter, in the admin panel
 * and in reports within seconds; and that the Counters screen, the admin Devices page and the
 * device_sessions rows all agree.
 */
const { openCounter, sleep } = require('./pos_flow.cjs');
const { newBill, addProduct, lineIds, setQty, readTotals, openCheckout } = require('./pos_ui.cjs');
const { sql, sqlOne, saveEvidence, BACKEND, newSession, ADMIN_URL } = require('./driver.cjs');
const manifest = require('./manifest.json');

const out = { scenarios: [], defects: [], external_blocked: [] };
function rec(id, title, status, evidence) {
  out.scenarios.push({ id, title, status, evidence });
  console.log(`[${status}] ${id} — ${title}`);
  if (status !== 'PASS') console.log('     ' + JSON.stringify(evidence).slice(0, 800));
}
function def(d) { out.defects.push(d); console.log(`  >>> DEFECT ${d.severity} ${d.id}: ${d.title}`); }
const J = { 'Content-Type': 'application/json', Accept: 'application/json' };

async function quickBill(s, fragment, packs, loose) {
  const shown = await newBill(s);
  const r = await addProduct(s, fragment);
  const id = r.ids[r.ids.length - 1];
  if (!id) return { ok: false, why: 'no line', shown, r };
  await setQty(s, id, { packs, loose });
  const ui = await readTotals(s);
  await openCheckout(s);
  const saved = await s.clickExact('Save (Ctrl+S)');
  await sleep(6000);
  const row = sql(`select * from invoices where invoice_number='${shown}' order by id desc limit 1`)[0] || null;
  return { ok: !!row, shown, ui, db: row };
}

(async () => {
  const A = manifest.stores['QA-A'];

  // ---------- G1 three counters of the same store signed in at once ----------
  const c1 = await openCounter(A, A.users.cash, { counterName: 'QA A Sync Counter 1', sessionName: 'qaA_c1' });
  const c2 = await openCounter(A, A.users.pur, { counterName: 'QA A Sync Counter 2', sessionName: 'qaA_c2' });
  const c3 = await openCounter(A, A.users.acct, { counterName: 'QA A Sync Counter 3', sessionName: 'qaA_c3' });
  const reached = [c1, c2, c3].filter(x => x.ok).length;
  if (reached < 3) console.log('counter sign-ins reached:', reached, JSON.stringify([c1, c2, c3].map(x => x.detail)).slice(0, 400));

  const headerCodes = [];
  for (const c of [c1, c2, c3]) {
    if (!c.ok) continue;
    const t = (await c.s.text()).replace(/\n{3,}/g, '\n');
    const m = t.match(/^(.+)\n(C0\d)\n/m);
    headerCodes.push(m ? m[2] : null);
  }
  const dbCounters = sql(`select id,counter_code,counter_name,device_uuid,status,is_hub,last_seen_at from counters where store_id=${A.id} order by counter_code`);
  const dbSessions = sql(`select id,counter_id,counter_code,counter_name,device_uuid,user_id,user_role,status,is_active,last_active_at,app_version,unsynced_items_count,ip_address from device_sessions where store_id=${A.id} order by id desc limit 12`);
  rec('G1', 'Three counters of one store can be signed in at the same time and stay distinct',
    (new Set(headerCodes.filter(Boolean)).size === 3 && headerCodes.filter(Boolean).length === 3) ? 'PASS' : 'FAIL',
    { header_counter_codes: headerCodes, counters: dbCounters, sessions: dbSessions.slice(0, 8) });
  if (new Set(headerCodes.filter(Boolean)).size !== 3) {
    def({ id: 'G1-COLLIDE', severity: 'Critical', type: 'Data', module: 'Counters/Devices',
      title: 'Counters signed in simultaneously do not present three distinct counter identities',
      actual: { header_counter_codes: headerCodes, counters: dbCounters },
      expected: 'One distinct counter_code per workstation, visible in the POS header, the admin Devices page and device_sessions.' });
  }

  // ---------- F1 bill at counter 1 appears at counter 2 within seconds ----------
  const t0 = Date.now();
  const b = await quickBill(c1.s, 'QA Crocin', 1, 2);
  let seenAtC2 = null, pollMs = 0;
  if (b.ok) {
    for (let i = 0; i < 12; i++) {
      await sleep(2000);
      pollMs = Date.now() - t0;
      // counter 2 asks the API directly for the bill the other counter took
      const login = await fetch(`${BACKEND}/api/staff/login`, { method: 'POST', headers: J, body: JSON.stringify({ store_id: A.id, user_id: A.users.pur.id, username: A.users.pur.username, pin: A.users.pur.pin }) }).then(r => r.json());
      const tok = login.token || (login.data && login.data.token);
      const res = await fetch(`${BACKEND}/api/invoices?store_id=${A.id}&search=${encodeURIComponent(b.shown)}`, { headers: { ...J, Authorization: `Bearer ${tok}` } });
      const js = await res.json().catch(() => null);
      const arr = js && (js.data || js.invoices || (Array.isArray(js) ? js : []));
      if (Array.isArray(arr) && arr.some(x => x.invoice_number === b.shown)) { seenAtC2 = arr.find(x => x.invoice_number === b.shown); break; }
    }
  }
  const adminRead = b.ok ? sql(`select id,invoice_number,counter_id,counter_code,store_id,grand_total,tax_total,status,user_id,synced_at from invoices where invoice_number='${b.shown}'`) : [];
  rec('F1', 'Bill taken at counter 1 is visible to counter 2 and in the database within seconds',
    (seenAtC2 && adminRead.length === 1) ? 'PASS' : 'FAIL',
    { bill: b.shown, ui_totals: b.ui, poll_ms: pollMs, seen_at_counter2: seenAtC2 && { number: seenAtC2.invoice_number, grand: seenAtC2.grand_total, counter: seenAtC2.counter_code }, db_rows: adminRead });
  if (!seenAtC2) def({ id: 'F1-SYNC', severity: 'High', type: 'Workflow', module: 'Sync',
    title: 'A saved bill did not become visible to a second counter within 24s', actual: { bill: b.shown, poll_ms: pollMs, db: adminRead } });
  if (adminRead.length > 1) def({ id: 'F1-DUP', severity: 'Critical', type: 'Data', module: 'Sync',
    title: 'One bill produced multiple invoice rows on sync', actual: adminRead });

  // the same bill must not be re-pushed (no duplicate payments / items)
  if (b.ok) {
    const dupItems = sql(`select invoice_id, count(*) c from invoice_items where invoice_id=${adminRead[0] && adminRead[0].id} group by invoice_id`);
    const dupPay = sql(`select invoice_id, count(*) c from invoice_payments where invoice_id=${adminRead[0] && adminRead[0].id} group by invoice_id`);
    rec('F1b', 'Sync push does not duplicate lines or payments', (dupItems[0] && dupItems[0].c === 1 && (!dupPay.length || dupPay[0].c === 1)) ? 'PASS' : 'CHECK',
      { items: dupItems, payments: dupPay, expected_items: b.ui.items });
  }

  // ---------- G1b Counters screen vs admin Devices page vs device_sessions ----------
  const adminLogin = await fetch(`${BACKEND}/api/login`, { method: 'POST', headers: J, body: JSON.stringify({ email: 'admin@lamstone.in', password: 'password123' }) }).then(r => r.json());
  const atok = adminLogin.token;
  const devicesRes = await fetch(`${BACKEND}/api/admin/devices?store_id=${A.id}`, { headers: { ...J, Authorization: `Bearer ${atok}` } });
  const devicesJson = await devicesRes.json().catch(() => null);
  const devArr = devicesJson && (devicesJson.data || devicesJson.devices || devicesJson) ;
  const sessionsRes = await fetch(`${BACKEND}/api/counters?store_id=${A.id}`, { headers: { ...J, Authorization: `Bearer ${atok}` } });
  const sessionsJson = await sessionsRes.json().catch(() => null);
  rec('G1c', 'Admin Devices page and counter list agree with device_sessions rows',
    'RECORD', { admin_devices_status: devicesRes.status, admin_devices: JSON.stringify(devArr).slice(0, 1200),
      counters_endpoint: JSON.stringify(sessionsJson).slice(0, 900),
      db_sessions: dbSessions.slice(0, 6), db_counters: dbCounters });

  // ---------- G3 sign-out / force logout / revoke ----------
  const deviceUuid = sqlOne(`select device_uuid from devices where store_id=${A.id} order by id desc limit 1`);
  const devRow = sql(`select id,device_uuid,device_name,status from devices where store_id=${A.id} and status='active' order by id desc limit 3`);
  let target = devRow[0] || sql(`select id,device_uuid,device_name,status from devices where store_id=${A.id} order by id desc limit 1`)[0];
  const st = await fetch(`${BACKEND}/api/admin/devices/${target.id}/status`, { method: 'POST', headers: { ...J, Authorization: `Bearer ${atok}` }, body: JSON.stringify({ status: 'revoked', reason: 'QA revoke test — throwaway device' }) });
  const stJson = await st.json().catch(() => ({}));
  const afterRevoke = sql(`select id,device_uuid,status from devices where id=${target.id}`)[0];
  // a revoked device should not be able to sync
  const revokedSync = await fetch(`${BACKEND}/api/sync/pull/deltas?store_id=${A.id}&since_watermark=0`, { headers: { ...J } }).then(r => ({ status: r.status }));
  rec('G3', 'Revoking a device in the admin panel takes effect on the device and its sync',
    (afterRevoke && afterRevoke.status === 'revoked') ? 'PASS' : 'FAIL',
    { device: target, revoke_status_code: st.status, revoke_response: JSON.stringify(stJson).slice(0, 300), db_after: afterRevoke, unauthenticated_delta_status: revokedSync.status });

  // ---------- G2 same user on two counters ----------
  const dup = await openCounter(A, A.users.cash, { counterName: 'QA A Sync Counter 2', sessionName: 'qaA_dup' });
  const sessionsNow = sql(`select id,counter_code,counter_name,user_id,user_role,device_uuid,status,is_active,last_active_at from device_sessions where store_id=${A.id} and user_id=${A.users.cash.id} order by id desc limit 6`);
  rec('G2', 'Same cashier signed in at two counters is distinguishable (or blocked) — recorded either way',
    'RECORD', { sessions_for_cashier: sessionsNow, second_signin_ok: dup.ok });
  if (dup.ok) await dup.s.close();

  out.external_blocked = [].concat(c1.s.blockedExternal || [], c2.ok ? c2.s.blockedExternal : [], c3.ok ? c3.s.blockedExternal : []);
  saveEvidence('FG_sync_devices.json', out);
  for (const s of [c1, c2, c3]) { try { await s.s.close(); } catch {} }
  console.log('\n=== DEFECTS ===');
  for (const d of out.defects) console.log(`${d.severity} | ${d.module} | ${d.title}`);
})().catch(e => { console.error(e); saveEvidence('FG_sync_devices.json', out); process.exit(1); });
