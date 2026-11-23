// J1.03-J1.06 activation: wrong, random, revoked, right, reused, second device, re-issue revokes old device
const { openTill, enterCode, issueCode } = require('./pos.cjs');
const { sql, api, evidence, state, saveState, sleep } = require('./lib.cjs');
const snap = (cid) => ({
  counter: sql(`select id,status,device_uuid,current_device_id,device_name,approved_at from counters where id=${cid}`)[0],
  keys: sql(`select id,is_revoked,consumed_at,consumed_device_uuid from activation_keys where counter_id=${cid} order by id`),
  attempts: sql(`select count(*) n from device_activation_attempts`)[0].n,
});
(async () => {
  const st = state(); const ev = { cases: [] };
  const CID = 2, SID = 4; // PH Front Till
  const A = await openTill('j1_03_tillA');
  const firstScreen = await A.text();
  ev.first_screen_ok = /activation code/i.test(firstScreen);
  const right = await issueCode(CID, SID);
  const wrong = right.slice(0, -1) + (right.endsWith('A') ? 'B' : 'A');
  const cases = [
    ['wrong (one char off)', wrong],
    ['random', 'LAM-C01-0123456789ABCDEF-FEDCBA9876543210'],
    ['garbage text', 'hello world'],
    ['revoked (superseded) code', st.revokedCode],
  ];
  for (const [label, code] of cases) {
    const before = snap(CID);
    const r = await enterCode(A, code);
    const after = snap(CID);
    const msg = (r.text.match(/(invalid|not recognised|not recognized|expired|revoked|already|used|wrong|could not|unknown|no such)[^\n]{0,140}/i) || [])[0] || null;
    const still = /Enter the counter activation code/.test(r.text);
    ev.cases.push({ label, code_prefix: code.slice(0, 12), claim: r.claim.map((c) => ({ st: c.st, res: c.res.slice(0, 300) })), ui_message: msg, still_on_activation: still, before, after });
    console.log(label, r.claim.map((c) => c.st).join(','), '|', msg, '| still on activation:', still, '| counter', after.counter.status);
    if (label.startsWith('wrong')) console.log('SCREEN:', r.text.replace(/\n+/g, ' | ').slice(0, 700));
    await A.screenshot(`j1_03_${label.replace(/\W+/g, '_')}`);
  }
  // right code
  const before = snap(CID);
  const r = await enterCode(A, right);
  await sleep(4000);
  const shell = await A.text();
  const after = snap(CID);
  let tok = null; try { tok = JSON.parse(r.claim[0].res).device_token; } catch { /* */ }
  const ctxCall = tok ? await api('GET', '/counter/context', undefined, { device: tok, token: tok }) : null;
  ev.right = { claim: r.claim.map((c) => ({ st: c.st, res: c.res.slice(0, 500) })), shell_head: shell.slice(0, 600), before, after, token_present: !!tok, context: ctxCall && { st: ctxCall.status, body: ctxCall.text.slice(0, 400) },
    loads: A.net.filter((n) => /\/api\/(store|products|settings|counter\/context|sync\/pull)/.test(n.url)).map((n) => n.method + ' ' + n.url.replace(/.*\/api/, '') + ' ' + n.status).slice(0, 20) };
  console.log('RIGHT', r.claim.map((c) => c.st), 'counter', JSON.stringify(after.counter), 'ctx', ctxCall && ctxCall.status);
  await A.screenshot('j1_04_after_right_code');
  st.tillA = { counterId: CID, token: tok }; saveState(st);
  // reused code on a second device
  const B = await openTill('j1_05_tillB');
  const rb = await enterCode(B, right);
  const msgB = (rb.text.match(/(invalid|expired|revoked|already|used|claimed|could not|another)[^\n]{0,160}/i) || [])[0] || null;
  ev.reuse_second_device = { claim: rb.claim.map((c) => ({ st: c.st, res: c.res.slice(0, 400) })), ui_message: msgB, still_on_activation: /Enter the counter activation code/.test(rb.text), after: snap(CID) };
  console.log('REUSE on B', rb.claim.map((c) => c.st), msgB);
  await B.screenshot('j1_05_reuse_refused');
  // the original device still works?
  const ctxAfterB = tok ? await api('GET', '/counter/context', undefined, { device: tok, token: tok }) : null;
  ev.a_still_works_after_B = ctxAfterB && ctxAfterB.status;
  // J1.06 re-issue revokes old device: issue a new code for the same counter and claim on B
  const fresh = await issueCode(CID, SID);
  const ctxAfterIssue = tok ? await api('GET', '/counter/context', undefined, { device: tok, token: tok }) : null;
  const rb2 = await enterCode(B, fresh);
  await sleep(3000);
  const ctxOldAfterClaim = tok ? await api('GET', '/counter/context', undefined, { device: tok, token: tok }) : null;
  // does till A notice? wait for heartbeat/poll then read its screen
  await sleep(20000);
  const aScreen = await A.text();
  ev.reissue = { a_ctx_after_issue_only: ctxAfterIssue && ctxAfterIssue.status, b_claim: rb2.claim.map((c) => c.st), a_ctx_after_b_claim: ctxOldAfterClaim && { st: ctxOldAfterClaim.status, body: ctxOldAfterClaim.text.slice(0, 200) }, a_screen_head: aScreen.slice(0, 400), counter: snap(CID) };
  console.log('REISSUE: A ctx after issue', ctxAfterIssue && ctxAfterIssue.status, 'B claim', rb2.claim.map((c) => c.st), 'A ctx after B claim', ctxOldAfterClaim && ctxOldAfterClaim.status, '| A screen:', aScreen.slice(0, 160).replace(/\n/g, ' '));
  await A.screenshot('j1_06_old_device_after_reissue');
  ev.attempt_rows = sql('select * from device_activation_attempts order by id desc limit 10');
  ev.audit = sql("select id,store_id,action,entity_type,entity_id,substr(new_values,1,160) nv from audit_logs where action like '%claim%' or action like '%activation%' or action like '%revok%' order by id desc limit 12");
  ev.blocked_external = A.blockedExternal.concat(B.blockedExternal).map((x) => x.url);
  evidence('J1_03_activation', ev);
  await A.close(); await B.close();
})();
