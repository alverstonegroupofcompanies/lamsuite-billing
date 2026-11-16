/**
 * Does a signed-in cashier keep their session across a reload / a typed-in URL?
 * Uses a workstation profile that is already enrolled, signs in, then navigates the way a
 * person does when they press Cmd+R or paste a link.
 */
const { newSession, saveEvidence, POS_URL } = require('./driver.cjs');
const { onboard, signInWithPin, sleep } = require('./pos_flow.cjs');
const manifest = require('./manifest.json');

const head = async (s) => (await s.text()).replace(/\n{3,}/g, '\n').slice(0, 200);
function verdict(t) {
  if (/Workstation Device Registration/i.test(t)) return 'DEVICE REGISTRATION (session lost)';
  if (/SELECT OPERATOR/i.test(t)) return 'operator picker (signed out)';
  if (/QUICK PIN|Authorize & Open Terminal/i.test(t)) return 'pin pad (signed out)';
  if (/Access Denied|Not Authorized|Unauthorized/i.test(t)) return 'access denied';
  return 'still signed in';
}

(async () => {
  const store = manifest.stores['QA-A'];
  const out = { steps: [] };
  const s = await newSession('qaA_money', { url: POS_URL, stable: true });
  const ob = await onboard(s, store.activation_key, 'QA A Money Counter 1');
  out.steps.push({ step: 'onboard', ok: ob.ok, reused: ob.reused, screen: ob.screen && String(ob.screen).slice(0, 160) });
  const si = await signInWithPin(s, store.users.cash.pin, store.users.cash.username);
  out.steps.push({ step: 'sign-in as ' + store.users.cash.username, ok: si.ok, detail: si.detail || si.why });
  if (!si.ok) { saveEvidence('N1_session_persistence.json', out); console.log('cannot continue: sign-in failed'); await s.close(); return; }
  await sleep(2500);

  out.steps.push({ step: 'after sign-in', url: s.page.url(), screen: await head(s), state: verdict(await head(s)) });

  // 1. same-route reload (Cmd+R)
  await s.page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(6000);
  let t = await head(s);
  out.steps.push({ step: 'after reload on the same route', url: s.page.url(), state: verdict(t), screen: t });

  // 2. back, which is what a cashier does when a dialog traps them
  await s.page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await sleep(4000);
  t = await head(s);
  out.steps.push({ step: 'after Back', url: s.page.url(), state: verdict(t), screen: t });

  // 3. typed-in deep link to another module, the way the D/E scenarios do
  for (const route of ['/purchases', '/stock', '/reports', '/bills']) {
    await s.page.goto(`${POS_URL}${route}`, { waitUntil: 'domcontentloaded' });
    await sleep(5000);
    t = await head(s);
    out.steps.push({ step: `goto ${route}`, url: s.page.url(), state: verdict(t), screen: t });
    console.log(`${route.padEnd(12)} -> ${verdict(t)}`);
  }
  await s.screenshot('N1_final');

  const lost = out.steps.filter(x => /session lost|signed out/i.test(x.state || ''));
  out.defect = lost.length ? {
    severity: 'High', type: 'Workflow', module: 'Sessions / Routing',
    title: 'A signed-in cashier loses the terminal session on reload or direct navigation',
    expected: 'the workstation stays signed in; navigation only changes the screen',
    actual: lost.map(x => `${x.step}: ${x.state}`),
    evidence: lost.map(x => x.screen),
  } : null;
  console.log('\nSTEPS:');
  for (const x of out.steps) console.log(` - ${x.step}: ${x.state || (x.ok === undefined ? '' : x.ok ? 'ok' : 'FAILED')}`);
  if (out.defect) console.log('\n>>> DEFECT:', JSON.stringify(out.defect, null, 1));
  saveEvidence('N1_session_persistence.json', out);
  await s.close();
})().catch(e => { console.error(e); process.exit(1); });
