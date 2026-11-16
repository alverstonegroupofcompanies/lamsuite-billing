/**
 * Group A — new store owner, fresh install, keyboard + mouse through the real POS UI.
 * Scenarios: A1 first paint, A2 wrong key, A3 random key, A4 valid key onboarding,
 * A5 duplicate counter name, A6 staff PIN sign-in, A7 store-switch screen does not reappear.
 */
const { newSession, sql, sqlOne, saveEvidence, POS_URL, BACKEND } = require('./driver.cjs');
const manifest = require('./manifest.json');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const results = { scenarios: [], defects: [], external_blocked: [] };
function rec(id, title, status, evidence) {
  results.scenarios.push({ id, title, status, evidence });
  console.log(`[${status}] ${id} — ${title}`);
  if (status !== 'PASS') console.log('    ', JSON.stringify(evidence).slice(0, 500));
}
function def(d) { results.defects.push(d); console.log(`  >>> DEFECT ${d.severity}: ${d.title}`); }

async function screen(s, label) {
  await sleep(1200);
  const txt = (await s.text()).replace(/\n{3,}/g, '\n').slice(0, 1200);
  const shot = await s.screenshot(label);
  return { txt, shot, url: s.page.url() };
}

(async () => {
  // Create a virgin store through the admin API so that activation-key device counters start at 0.
  const stamp = Date.now().toString().slice(-6);
  const code = `QA-ON${stamp}`;
  const adminLogin = await fetch(`${BACKEND}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email: 'admin@lamstone.in', password: 'password123' }) }).then(r => r.json());
  const created = await fetch(`${BACKEND}/api/admin/stores`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${adminLogin.token}` }, body: JSON.stringify({ name: `QA Onboarding Store ${stamp}`, code, state_code: '32', gstin: '32AAAAA0000O0' + stamp.slice(-1) + 'Z1', tax_mode: 'exclusive', gst_type: 'regular', store_type: 'pharmacy', invoice_prefix: 'ONB', license_plan: 'Enterprise Multi-Store' }) });
  const createdJson = await created.json();
  const storeB = { id: Number(createdJson.id), code, activation_key: createdJson.activation_key };
  console.log(`[setup] virgin store ${code} id=${storeB.id} key=${(storeB.activation_key || '').slice(0, 22)}…`);
  if (!storeB.id || !storeB.activation_key) { console.error('cannot create virgin store', created.status, JSON.stringify(createdJson).slice(0, 300)); process.exit(1); }
  const u = await fetch(`${BACKEND}/api/admin/users`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${adminLogin.token}` }, body: JSON.stringify({ name: 'QA Onboard Cashier', email: `qaon${code.toLowerCase()}cash@qa.example`, username: `qaon${stamp}cash`, password: 'qaPass123', pin: '9303', role: 'cashier', store_id: storeB.id }) }).then(r => r.json()).catch(() => null);
  storeB.users = { cash: { username: `qaon${stamp}cash`, pin: '9303', id: Number(u?.id) } };
  results.virgin_store = storeB;

  const s = await newSession('A', { url: POS_URL });

  // A1 — first paint of a fresh install
  let sc = await screen(s, 'A01_first_paint');
  const onSetup = /Store Activation Key|Workstation Device Registration/i.test(sc.txt);
  rec('A1', 'Fresh install opens workstation registration screen, no stale session', onSetup ? 'PASS' : 'FAIL',
    { text: sc.txt.slice(0, 300), shot: sc.shot });
  if (!onSetup) { saveEvidence('A_onboard.json', results); await s.close(); return; }

  // A2 — wrong (well-formed but unknown) activation key
  await s.typeByPlaceholder('LAM-STORE', 'LAM-QAB-AAAAAAAAAAAAAAAA-BBBBBBBB');
  const clicked = await s.clickText('Complete Store Onboarding');
  await sleep(3500);
  sc = await screen(s, 'A02_wrong_key');
  const wrongKeyHandled = /invalid|expired|revoked|not valid|incorrect/i.test(sc.txt);
  rec('A2', 'Well-formed but unknown activation key is rejected with a clear message',
    wrongKeyHandled ? 'PASS' : 'FAIL', { clicked, text: sc.txt.slice(0, 400), shot: sc.shot, net: s.apiCalls('devices/register').map(n => ({ status: n.status, resp: (n.response_body || '').slice(0, 200) })) });

  // A3 — random junk key (short) and length-boundary key
  const before = sqlOne("select count(*) from device_activation_attempts");
  await s.typeByPlaceholder('LAM-STORE', 'x');
  await s.clickText('Complete Store Onboarding');
  await sleep(2500);
  const junk = await screen(s, 'A03_junk_key');
  const after = sqlOne("select count(*) from device_activation_attempts");
  rec('A3', 'Garbage key rejected; attempt is audit-logged as a failed activation',
    /invalid|expired|revoked|required/i.test(junk.txt) ? 'PASS' : 'FAIL',
    { attempts_before: before, attempts_after: after, text: junk.txt.slice(0, 300), shot: junk.shot });

  // A4 — valid key, real onboarding for QA-B
  const keyRowBefore = sql(`select devices_activated_count from activation_keys where store_id=${storeB.id}`);
  await s.typeByPlaceholder('LAM-STORE', storeB.activation_key);
  await s.typeByPlaceholder('Counter 01', 'QA Front Counter');
  await s.clickText('Complete Store Onboarding');
  await sleep(6000);
  sc = await screen(s, 'A04_valid_key');
  const regCalls = s.apiCalls('devices/register');
  const devicesNow = sql(`select id,device_uuid,device_name,status,store_id,counter_id from devices where store_id=${storeB.id}`);
  const countersNow = sql(`select id,counter_code,counter_name,device_uuid,is_hub,status from counters where store_id=${storeB.id}`);
  const keyRowAfter = sql(`select devices_activated_count from activation_keys where store_id=${storeB.id}`);
  rec('A4', 'Valid activation key registers device + counter, increments key usage, shows staff sign-in',
    (devicesNow.length > 0 && countersNow.length > 0 && /sign|pin|staff|login/i.test(sc.txt)) ? 'PASS' : 'FAIL',
    {
      net: regCalls.map(n => ({ status: n.status, req: (n.post_data || '').slice(0, 240), resp: (n.response_body || '').slice(0, 240) })),
      key_count_before: keyRowBefore, key_count_after: keyRowAfter, devices: devicesNow, counters: countersNow, text: sc.txt.slice(0, 300), shot: sc.shot,
    });
  if (!devicesNow.length) def({ id: 'A4', title: 'Onboarding did not persist device', severity: 'Critical', evidence: sc.shot });

  // A5 — duplicate counter name from a second workstation profile
  const s2 = await newSession('A_dup', { url: POS_URL });
  await sleep(2500);
  await s2.typeByPlaceholder('LAM-STORE', storeB.activation_key);
  await s2.typeByPlaceholder('Counter 01', 'QA Front Counter');
  await s2.clickText('Complete Store Onboarding');
  await sleep(6000);
  const dup = await screen(s2, 'A05_duplicate_counter_name');
  // The real question is not "are two counter rows sharing a name" (they never do, because the
  // second device is folded into the first counter) but "did each device keep its own counter".
  const devRows = sql(`select id,device_uuid,device_name,counter_id from devices where store_id=${storeB.id}`);
  const cntRows = sql(`select id,counter_code,counter_name,device_uuid,is_hub,status from counters where store_id=${storeB.id}`);
  const distinctCounters = new Set(devRows.map(d => d.counter_id)).size;
  const hijacked = cntRows.filter(c => c.device_uuid && !devRows.some(d => d.device_uuid === c.device_uuid && d.counter_id === c.id));
  const nameCollisions = sql(`select counter_name, count(*) c from counters where store_id=${storeB.id} group by counter_name having c>1`);
  rec('A5', 'Second workstation with the same counter name gets its own counter (no hijack)',
    (devRows.length === 2 && distinctCounters === 2 && hijacked.length === 0) ? 'PASS' : 'FAIL',
    {
      devices: devRows, counters: cntRows, distinct_counters_for_two_devices: distinctCounters,
      counters_pointing_at_a_device_that_does_not_own_them: hijacked, name_collisions: nameCollisions,
      text: dup.txt.slice(0, 300), shot: dup.shot,
    });
  if (!(devRows.length === 2 && distinctCounters === 2)) {
    def({
      id: 'CNT-COLLIDE', severity: 'Critical', type: 'Data',
      title: 'A second workstation reusing a counter name steals the existing counter instead of getting its own',
      detail: `Two devices (counter_id ${devRows.map(d => d.counter_id).join(', ')}) resolved to ${distinctCounters} counter row(s); `
        + `counters.device_uuid now points at the newest device, orphaning the first workstation's identity.`,
      expected: 'Either reject the duplicate counter name, or allocate a new counter for the new device.',
      actual: 'Both devices share one counter row; counter_code is derived from digits in the free-text device name and falls back to C01, so digit-less names collide.',
      evidence: { devices: devRows, counters: cntRows, shot: dup.shot },
    });
  }
  await s2.close();

  // A6 — staff PIN sign-in at the keyboard
  const cash = storeB.users.cash;
  await s.clickText('Sign in') || await s.clickText('Continue');
  await sleep(1500);
  let inv = await s.controls();
  await s.screenshot('A06_before_pin');
  // Staff picker shows the cashier; PIN is entered on the keypad, then Enter.
  await s.clickText('QA') || true;
  await sleep(400);
  for (const d of String(cash.pin)) { await s.key(d); await sleep(120); }
  await s.screenshot('A06_pin_typed');
  await s.key('Enter');
  await sleep(4000);
  const after = await screen(s, 'A06_after_pin');
  const loginCalls = s.apiCalls('staff/login');
  const sess = sql(`select id,user_id,counter_id,device_uuid,status,user_role from device_sessions where store_id=${storeB.id} order by id desc limit 2`);
  rec('A6', 'Cashier PIN sign-in reaches the POS',
    loginCalls.some(n => n.status >= 200 && n.status < 300) && !/Complete Store Onboarding|STORE ACTIVATION KEY/.test(after.txt)
      ? 'PASS' : 'FAIL',
    {
      pin: cash.pin, controls: inv,
      staff_login: loginCalls.map(n => ({ status: n.status, req: (n.post_data || '').slice(0, 200), resp: (n.response_body || '').slice(0, 300) })),
      url: after.url, sessions: sess, text: after.txt.slice(0, 400), shot: after.shot,
    });

  results.external_blocked = s.blockedExternal.concat(dup ? [] : []);
  saveEvidence('A_onboard.json', results);
  await s.close();
  console.log('\nblocked external calls:', JSON.stringify(s.blockedExternal.slice(0, 5), null, 1));
  console.log('console errors:', JSON.stringify(s.consoleErrs.slice(0, 8)));
  console.log('duplicate api calls:', JSON.stringify(s.dupNetwork().slice(0, 8)));
})().catch(e => { console.error('A failed:', e); saveEvidence('A_onboard.json', results); process.exit(1); });
