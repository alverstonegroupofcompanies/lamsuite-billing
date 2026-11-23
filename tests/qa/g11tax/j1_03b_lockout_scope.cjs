// J1.03b (ACT-01): five wrong codes on one till must not block another till
// behind the same shop network.
//
// The lockout is per workstation. The only shared gate is a high per-IP ceiling
// (50 refusals in the window), so this script spends 5 and stays well below it.
// It creates its own unclaimed counter so it can be run against any QA database.
const { api, sql, evidence, adminToken, sleep } = require('./lib.cjs');
const { issueCode } = require('./pos.cjs');

const STORE = 4;
const DEVICE_A = `qa-lockout-a-${Date.now()}`;
const DEVICE_B = `qa-lockout-b-${Date.now()}`;
const WRONG = 'LAM-C01-AAAAAAAAAAAAAAAA-BBBBBBBBBBBBBBBB';

async function claim(code, deviceUuid, deviceName) {
  return api('POST', '/counters/claim', { code, device_uuid: deviceUuid, device_name: deviceName });
}

(async () => {
  const ev = { devices: { locked: DEVICE_A, spared: DEVICE_B } };
  const t = await adminToken();
  const codeSuffix = String(Date.now()).slice(-6);

  const created = await api('POST', '/admin/counters', {
    counter_name: `QA Lockout Scope ${codeSuffix}`,
    counter_code: `Q${codeSuffix}`,
    location_name: 'QA',
  }, { token: t, store: STORE });
  if (created.status >= 400) throw new Error('counter create failed ' + created.status + ' ' + created.text);
  const counter = created.json.counter || created.json.data;
  ev.counter = { id: counter.id, code: counter.counter_code };

  // Five refusals from till A lock A, and only A.
  const failures = [];
  for (let i = 0; i < 5; i++) {
    const r = await claim(WRONG, DEVICE_A, 'QA Lockout A');
    failures.push({ st: r.status, error: r.json && r.json.error });
  }
  ev.five_failures = failures;

  // A keeps typing: even a valid code is refused on the workstation that guessed.
  const validForA = await issueCode(counter.id, STORE);
  const blockedA = await claim(validForA, DEVICE_A, 'QA Lockout A');
  ev.locked_device = { st: blockedA.status, error: blockedA.json && blockedA.json.error, token: !!(blockedA.json && blockedA.json.device_token) };

  // B never guessed: the same code claims, on the same network.
  const sparedB = await claim(validForA, DEVICE_B, 'QA Lockout B');
  ev.spared_device = { st: sparedB.status, error: sparedB.json && sparedB.json.error, token: !!(sparedB.json && sparedB.json.device_token) };

  await sleep(500);
  ev.counter_after = sql(`select id,status,device_uuid from counters where id=${counter.id}`)[0];
  ev.attempt_rows = sql(`select device_uuid,ip_address,failure_reason,success from device_activation_attempts where counter_id=${counter.id} order by id`);
  ev.verdict = {
    locked_device_refused: blockedA.status === 429,
    second_device_claimed: sparedB.status === 200 && !!(sparedB.json && sparedB.json.device_token),
    counter_bound_to_b: ev.counter_after && ev.counter_after.device_uuid === DEVICE_B,
  };

  const path = evidence('J1_03b_lockout_scope', ev);
  console.log(JSON.stringify(ev.verdict));
  if (!ev.verdict.locked_device_refused || !ev.verdict.second_device_claimed || !ev.verdict.counter_bound_to_b) {
    console.error('FAILED — see', path);
    process.exitCode = 1;
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
